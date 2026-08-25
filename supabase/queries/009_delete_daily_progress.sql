-- Exclusão rastreável de um Diário de Obra com recálculo cronológico da atividade.
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

  select coalesce(jsonb_agg(ph.storage_path), '[]'::jsonb)
  into v_deleted_paths from public.update_photos ph where ph.update_id = p_update_id;
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

revoke execute on function public.delete_daily_progress(uuid) from public, anon;
grant execute on function public.delete_daily_progress(uuid) to authenticated;
