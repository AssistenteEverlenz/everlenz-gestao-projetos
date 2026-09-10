-- Run inside a transaction and ROLLBACK; requires a project with an engineer and a manager
-- and at least one Diário de Obra entry created by someone other than the engineer.
do $$
declare v_user uuid; v_manager uuid; v_project uuid; v_task uuid; v_report uuid; v_update uuid;
begin
  select pm.user_id,pm.project_id into v_user,v_project from public.project_members pm where pm.role='engineer' limit 1;
  select pm.user_id into v_manager from public.project_members pm where pm.project_id=v_project and pm.role in ('admin','manager') limit 1;
  select t.id into v_task from public.tasks t where t.project_id=v_project limit 1;
  select u.id into v_update from public.task_updates u join public.daily_logs d on d.id=u.daily_log_id
  where d.project_id=v_project and u.created_by<>v_user limit 1;
  if v_user is null or v_manager is null or v_task is null or v_update is null then raise exception 'Missing test fixtures'; end if;
  insert into public.status_reports(project_id,report_date,sequence,created_by)
  values(v_project,'1900-01-01',-1,v_manager) returning id into v_report;

  perform set_config('request.jwt.claim.sub',v_user::text,true);
  begin
    perform public.delete_project_tasks(v_project,array[v_task]);
    raise exception 'Ordinary user deleted Gantt tasks';
  exception when others then
    if sqlerrm = 'Ordinary user deleted Gantt tasks' then raise; end if;
  end;
  begin
    perform public.transition_status_report(v_report,'approved');
    raise exception 'Ordinary user changed report status';
  exception when others then
    if sqlerrm = 'Ordinary user changed report status' then raise; end if;
  end;
  begin
    perform public.delete_daily_progress(v_update);
    raise exception 'Ordinary user deleted another author entry';
  exception when others then
    if sqlerrm = 'Ordinary user deleted another author entry' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub',v_manager::text,true);
  perform public.transition_status_report(v_report,'approved');
  if not exists(select 1 from public.status_reports where id=v_report and status='approved') then
    raise exception 'Manager cannot change report status';
  end if;
end $$;
