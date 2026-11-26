-- Diário de Obra com várias atividades no mesmo registro.
-- Uma foto pode servir de evidência para mais de uma atividade: o arquivo é enviado uma vez
-- ao Storage e cada atividade vinculada recebe a sua linha em update_photos.
begin;

alter table public.update_photos drop constraint if exists update_photos_storage_path_key;
alter table public.update_photos drop constraint if exists update_photos_update_id_storage_path_key;
alter table public.update_photos add constraint update_photos_update_id_storage_path_key unique (update_id, storage_path);
create index if not exists update_photos_storage_path_idx on public.update_photos(storage_path);

create or replace function public.update_daily_progress(
  p_update_id uuid,
  p_title text,
  p_description text,
  p_progress_delta numeric,
  p_crew_count integer,
  p_weather text,
  p_keep_photo_ids uuid[] default '{}'::uuid[],
  p_new_photos jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_project_id uuid;
  v_task_id uuid;
  v_author_id uuid;
  v_created_at timestamptz;
  v_running numeric(5,2);
  v_after numeric(5,2);
  v_deleted_paths jsonb;
  v_photo jsonb;
  v_sort integer;
  v_row record;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_progress_delta < 0 then raise exception 'progress delta cannot be negative'; end if;

  select d.project_id, u.task_id, u.created_by, u.created_at, u.progress_before
  into v_project_id, v_task_id, v_author_id, v_created_at, v_running
  from public.task_updates u
  join public.daily_logs d on d.id = u.daily_log_id
  where u.id = p_update_id
  for update of u;
  if not found then raise exception 'daily progress not found'; end if;
  if v_author_id <> auth.uid() and not public.has_project_role(v_project_id, array['admin','manager']::public.project_role[]) then
    raise exception 'user cannot edit this daily progress';
  end if;

  update public.task_updates set
    title = trim(p_title), description = trim(p_description), progress_delta = p_progress_delta,
    progress_after = progress_before + p_progress_delta,
    crew_count = greatest(0, p_crew_count), weather = p_weather
  where id = p_update_id;

  for v_row in
    select u.id, u.progress_delta
    from public.task_updates u
    where u.task_id = v_task_id
      and (u.created_at > v_created_at or (u.created_at = v_created_at and u.id >= p_update_id))
    order by u.created_at, u.id
  loop
    v_after := v_running + v_row.progress_delta;
    if v_after > 100 then raise exception 'edited progress would exceed 100 percent'; end if;
    update public.task_updates set progress_before = v_running, progress_after = v_after where id = v_row.id;
    v_running := v_after;
  end loop;

  update public.tasks set progress = v_running,
    actual_start = case when v_running > 0 then coalesce(actual_start, current_date) else null end,
    actual_end = case when v_running = 100 then coalesce(actual_end, current_date) else null end
  where id = v_task_id and project_id = v_project_id;

  -- Só devolve para exclusão do Storage os arquivos que nenhum outro registro usa.
  select coalesce(jsonb_agg(ph.storage_path), '[]'::jsonb) into v_deleted_paths
  from public.update_photos ph
  where ph.update_id = p_update_id and not (ph.id = any(coalesce(p_keep_photo_ids, '{}'::uuid[])))
    and not exists (select 1 from public.update_photos other
      where other.storage_path = ph.storage_path and other.update_id <> p_update_id);

  delete from public.update_photos ph
  where ph.update_id = p_update_id and not (ph.id = any(coalesce(p_keep_photo_ids, '{}'::uuid[])));
  select coalesce(max(ph.sort_order), -1) + 1 into v_sort from public.update_photos ph where ph.update_id = p_update_id;
  for v_photo in select value from jsonb_array_elements(coalesce(p_new_photos, '[]'::jsonb))
  loop
    insert into public.update_photos(update_id, storage_path, original_name, caption, mime_type, size_bytes, taken_at, sort_order, created_by)
    values(p_update_id, v_photo->>'storage_path', v_photo->>'original_name', v_photo->>'caption', v_photo->>'mime_type',
      nullif(v_photo->>'size_bytes','')::bigint, nullif(v_photo->>'taken_at','')::timestamptz, v_sort, auth.uid());
    v_sort := v_sort + 1;
  end loop;

  update public.status_reports set overall_progress = public.project_progress(v_project_id)
  where project_id = v_project_id;
  return jsonb_build_object('deleted_paths', v_deleted_paths, 'task_progress', v_running);
end;
$$;

create or replace function public.delete_daily_progress(p_update_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_project_id uuid;
  v_task_id uuid;
  v_author_id uuid;
  v_log_id uuid;
  v_running numeric(5,2) := 0;
  v_deleted_paths jsonb;
  v_row record;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select d.project_id, u.task_id, u.created_by, u.daily_log_id
  into v_project_id, v_task_id, v_author_id, v_log_id
  from public.task_updates u
  join public.daily_logs d on d.id = u.daily_log_id
  where u.id = p_update_id
  for update of u;
  if not found then raise exception 'daily progress not found'; end if;
  if v_author_id <> auth.uid() and not public.has_project_role(v_project_id, array['admin','manager']::public.project_role[]) then
    raise exception 'user cannot delete this daily progress';
  end if;

  -- Só devolve para exclusão do Storage os arquivos que nenhum outro registro usa.
  select coalesce(jsonb_agg(ph.storage_path), '[]'::jsonb)
  into v_deleted_paths from public.update_photos ph
  where ph.update_id = p_update_id
    and not exists (select 1 from public.update_photos other
      where other.storage_path = ph.storage_path and other.update_id <> p_update_id);
  delete from public.status_report_updates where update_id = p_update_id;
  delete from public.task_updates where id = p_update_id;

  for v_row in
    select u.id, u.progress_delta from public.task_updates u
    where u.task_id = v_task_id order by u.created_at, u.id
  loop
    update public.task_updates set progress_before = v_running,
      progress_after = least(100, v_running + v_row.progress_delta) where id = v_row.id;
    v_running := least(100, v_running + v_row.progress_delta);
  end loop;

  update public.tasks set progress = v_running,
    actual_start = case when v_running > 0 then actual_start else null end,
    actual_end = case when v_running = 100 then actual_end else null end
  where id = v_task_id and project_id = v_project_id;

  delete from public.daily_logs d where d.id = v_log_id
    and not exists (select 1 from public.task_updates u where u.daily_log_id = d.id);
  update public.status_reports set overall_progress = public.project_progress(v_project_id)
  where project_id = v_project_id;
  return jsonb_build_object('deleted_paths', v_deleted_paths, 'task_progress', v_running);
end;
$$;

-- Grava todas as atividades do registro numa única transação: ou entram todas, ou nenhuma.
-- p_items: [{ task_id, progress_delta, title?, photos: [{ storage_path, original_name, mime_type, size_bytes }] }]
-- p_teams: [{ team_id, worker_count }] — as equipes valem para todas as atividades do registro.
create or replace function public.record_daily_progress_batch(
  p_project_id uuid,
  p_log_date date,
  p_title text,
  p_description text,
  p_crew_count integer,
  p_weather text,
  p_items jsonb,
  p_teams jsonb default '[]'::jsonb
) returns uuid[] language plpgsql security definer set search_path = ''
as $$
declare
  v_item jsonb;
  v_team jsonb;
  v_update_id uuid;
  v_ids uuid[] := '{}'::uuid[];
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Selecione ao menos uma atividade.';
  end if;
  if (select count(distinct item->>'task_id') from jsonb_array_elements(p_items) item) <> jsonb_array_length(p_items) then
    raise exception 'A mesma atividade foi selecionada mais de uma vez.';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p_items) item,
      jsonb_array_elements(coalesce(item->'photos', '[]'::jsonb)) photo
  ) then
    raise exception 'Anexe ao menos uma foto ao registro.';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    -- record_daily_progress valida o papel do usuário, a atividade e o limite de 100%.
    v_update_id := public.record_daily_progress(
      p_project_id,
      (v_item->>'task_id')::uuid,
      p_log_date,
      coalesce(nullif(trim(v_item->>'title'), ''), p_title),
      p_description,
      (v_item->>'progress_delta')::numeric,
      p_crew_count,
      p_weather,
      coalesce(v_item->'photos', '[]'::jsonb)
    );
    v_ids := v_ids || v_update_id;
    for v_team in select value from jsonb_array_elements(coalesce(p_teams, '[]'::jsonb))
    loop
      insert into public.task_update_teams(update_id, team_id, worker_count)
      select v_update_id, t.id, greatest(1, coalesce((v_team->>'worker_count')::integer, 1))
      from public.project_teams t
      where t.id = (v_team->>'team_id')::uuid and t.project_id = p_project_id;
    end loop;
  end loop;
  return v_ids;
end;
$$;

revoke execute on function public.record_daily_progress_batch(uuid,date,text,text,integer,text,jsonb,jsonb) from public, anon;
grant execute on function public.record_daily_progress_batch(uuid,date,text,text,integer,text,jsonb,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
