-- Edição rastreável do Diário de Obra, com recálculo dos lançamentos seguintes.
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

  select coalesce(jsonb_agg(ph.storage_path), '[]'::jsonb) into v_deleted_paths
  from public.update_photos ph
  where ph.update_id = p_update_id and not (ph.id = any(coalesce(p_keep_photo_ids, '{}'::uuid[])));

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

revoke execute on function public.update_daily_progress(uuid,text,text,numeric,integer,text,uuid[],jsonb) from public, anon;
grant execute on function public.update_daily_progress(uuid,text,text,numeric,integer,text,uuid[],jsonb) to authenticated;

create policy "project managers delete worksite photos" on storage.objects for delete to authenticated using (
  bucket_id = 'worksite-photos' and exists (
    select 1 from public.project_members pm
    where pm.user_id = auth.uid() and pm.project_id::text = (storage.foldername(name))[2]
      and pm.role in ('admin','manager')
  )
);
