-- Funções e gatilhos. A medição diária é atômica: diário + avanço + fotos.
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end; $$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();
create trigger daily_logs_touch before update on public.daily_logs for each row execute function public.touch_updated_at();
create trigger reports_touch before update on public.status_reports for each row execute function public.touch_updated_at();

create or replace function public.recalculate_parent_progress()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.parent_id is not null then
    update public.tasks parent
    set progress = coalesce((
      select round(sum(child.progress * child.weight) / nullif(sum(child.weight), 0), 2)
      from public.tasks child where child.parent_id = new.parent_id
    ), 0)
    where parent.id = new.parent_id;
  end if;
  return new;
end;
$$;
create trigger tasks_recalculate_parent_after_insert
after insert on public.tasks for each row execute function public.recalculate_parent_progress();
create trigger tasks_recalculate_parent_after_update
after update of progress, weight, parent_id on public.tasks for each row
when (new.parent_id is not null) execute function public.recalculate_parent_progress();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.has_project_role(target_project_id uuid, allowed_roles public.project_role[])
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.project_members pm where pm.project_id = target_project_id and pm.user_id = auth.uid() and pm.role = any(allowed_roles)) $$;
revoke execute on function public.has_project_role(uuid,public.project_role[]) from public, anon;
grant execute on function public.has_project_role(uuid,public.project_role[]) to authenticated;

create or replace function public.create_organization(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_org_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and organization_id is not null) then
    raise exception 'user already belongs to an organization';
  end if;
  insert into public.organizations(name, slug) values (trim(p_name), lower(trim(p_slug))) returning id into v_org_id;
  update public.profiles set organization_id = v_org_id where id = auth.uid();
  return v_org_id;
end;
$$;

create or replace function public.create_project_with_owner(
  p_name text, p_client_name text, p_address text, p_start_date date,
  p_planned_end_date date, p_contract_number text default null, p_description text default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_project_id uuid; v_org_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select organization_id into v_org_id from public.profiles where id = auth.uid();
  if v_org_id is null then raise exception 'user does not belong to an organization'; end if;
  insert into public.projects(organization_id, name, client_name, address, start_date, planned_end_date, contract_number, description, created_by)
  values(v_org_id, trim(p_name), trim(p_client_name), trim(p_address), p_start_date, p_planned_end_date, nullif(trim(p_contract_number), ''), nullif(trim(p_description), ''), auth.uid())
  returning id into v_project_id;
  insert into public.project_members(project_id, user_id, role, accepted_at) values(v_project_id, auth.uid(), 'admin', now());
  return v_project_id;
end;
$$;

create or replace function public.record_daily_progress(
  p_project_id uuid,
  p_task_id uuid,
  p_log_date date,
  p_title text,
  p_description text,
  p_progress_delta numeric,
  p_crew_count integer default 0,
  p_weather text default null,
  p_photos jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_log_id uuid; v_update_id uuid; v_before numeric(5,2); v_after numeric(5,2); v_photo jsonb; v_index integer := 0;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.has_project_role(p_project_id, array['admin','manager','engineer','foreman']::public.project_role[]) then
    raise exception 'user cannot record progress for this project';
  end if;
  if p_progress_delta < 0 then raise exception 'progress delta cannot be negative'; end if;

  select progress into v_before from public.tasks
  where id = p_task_id and project_id = p_project_id
  for update;
  if not found then raise exception 'task not found in project'; end if;
  v_after := v_before + p_progress_delta;
  if v_after > 100 then raise exception 'progress cannot exceed 100 percent'; end if;

  insert into public.daily_logs(project_id, log_date, weather, crew_count, created_by)
  values(p_project_id, p_log_date, p_weather, p_crew_count, auth.uid())
  on conflict(project_id, log_date) do update
    set weather = coalesce(excluded.weather, public.daily_logs.weather),
        crew_count = greatest(public.daily_logs.crew_count, excluded.crew_count)
  returning id into v_log_id;

  insert into public.task_updates(daily_log_id, task_id, title, description, progress_before, progress_delta, progress_after, crew_count, weather, created_by)
  values(v_log_id, p_task_id, trim(p_title), trim(p_description), v_before, p_progress_delta, v_after, p_crew_count, p_weather, auth.uid())
  returning id into v_update_id;

  update public.tasks set progress = v_after,
    actual_start = case when v_before = 0 and p_progress_delta > 0 then coalesce(actual_start, p_log_date) else actual_start end,
    actual_end = case when v_after = 100 then p_log_date else actual_end end
  where id = p_task_id;

  for v_photo in select value from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb))
  loop
    insert into public.update_photos(update_id, storage_path, original_name, caption, mime_type, size_bytes, taken_at, sort_order, created_by)
    values(v_update_id, v_photo->>'storage_path', v_photo->>'original_name', v_photo->>'caption', v_photo->>'mime_type',
      nullif(v_photo->>'size_bytes','')::bigint, nullif(v_photo->>'taken_at','')::timestamptz, v_index, auth.uid());
    v_index := v_index + 1;
  end loop;
  return v_update_id;
end;
$$;

create or replace function public.project_progress(p_project_id uuid)
returns numeric language sql stable security invoker set search_path = ''
as $$
  select coalesce(round(sum(t.progress * t.weight) / nullif(sum(t.weight), 0), 2), 0)
  from public.tasks t where t.project_id = p_project_id
    and not exists (select 1 from public.tasks child where child.parent_id = t.id)
$$;

create or replace function public.create_daily_status_report(
  p_project_id uuid, p_report_date date, p_executive_summary text default null
) returns uuid language plpgsql security invoker set search_path = ''
as $$
declare v_report_id uuid; v_sequence integer;
begin
  perform 1 from public.projects where id = p_project_id for update;
  if not found then raise exception 'project not found'; end if;
  select coalesce(max(r.sequence), 0) + 1 into v_sequence
  from public.status_reports r where r.project_id = p_project_id;

  insert into public.status_reports(
    project_id, report_date, sequence, executive_summary,
    overall_progress, created_by
  ) values (
    p_project_id, p_report_date, v_sequence, p_executive_summary,
    public.project_progress(p_project_id), auth.uid()
  )
  on conflict(project_id, report_date) do update set
    executive_summary = coalesce(excluded.executive_summary, public.status_reports.executive_summary),
    overall_progress = excluded.overall_progress
  returning id into v_report_id;

  insert into public.status_report_updates(report_id, update_id)
  select v_report_id, u.id
  from public.task_updates u
  join public.daily_logs d on d.id = u.daily_log_id
  where d.project_id = p_project_id and d.log_date = p_report_date
  on conflict do nothing;
  return v_report_id;
end;
$$;

revoke execute on function public.create_organization(text,text) from public, anon;
revoke execute on function public.create_project_with_owner(text,text,text,date,date,text,text) from public, anon;
revoke execute on function public.record_daily_progress(uuid,uuid,date,text,text,numeric,integer,text,jsonb) from public, anon;
revoke execute on function public.create_daily_status_report(uuid,date,text) from public, anon;
grant execute on function public.create_organization(text,text) to authenticated;
grant execute on function public.create_project_with_owner(text,text,text,date,date,text,text) to authenticated;
grant execute on function public.record_daily_progress(uuid,uuid,date,text,text,numeric,integer,text,jsonb) to authenticated;
grant execute on function public.create_daily_status_report(uuid,date,text) to authenticated;
