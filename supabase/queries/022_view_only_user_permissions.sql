-- Perfil Usuário (engineer/foreman/client) apenas visualiza Gantt e Status Reports.
-- No Diário de Obra ele cria registros, mas só edita/exclui os próprios;
-- administradores e gestores moderam os registros de qualquer autor.
begin;

-- Gantt: somente administradores e gestores alteram atividades e dependências.
alter policy "planning team manages tasks" on public.tasks
using (public.has_project_role(project_id, array['admin','manager']::public.project_role[]))
with check (public.has_project_role(project_id, array['admin','manager']::public.project_role[]));

alter policy "planning team manages dependencies" on public.task_dependencies
using (exists (select 1 from public.tasks t where t.id = predecessor_id
  and public.has_project_role(t.project_id, array['admin','manager']::public.project_role[])))
with check (exists (select 1 from public.tasks t where t.id = predecessor_id
  and public.has_project_role(t.project_id, array['admin','manager']::public.project_role[])));

create or replace function public.delete_project_tasks(
  p_project_id uuid,
  p_task_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if not public.has_project_role(
    p_project_id,
    array['admin','manager']::public.project_role[]
  ) then
    raise exception 'Sem permissão para excluir atividades deste projeto.';
  end if;

  if exists (
    select 1 from public.task_updates u
    join public.tasks t on t.id = u.task_id
    where t.project_id = p_project_id and t.id = any(p_task_ids)
  ) then
    raise exception 'Uma ou mais atividades possuem registros no Diário de Obra.';
  end if;

  if exists (
    select 1 from public.tasks child
    where child.project_id = p_project_id
      and child.parent_id = any(p_task_ids)
      and not (child.id = any(p_task_ids))
  ) then
    raise exception 'Inclua todos os subitens dos itens-pai na exclusão.';
  end if;

  delete from public.task_dependencies
  where predecessor_id = any(p_task_ids) or successor_id = any(p_task_ids);

  loop
    delete from public.tasks task
    where task.project_id = p_project_id
      and task.id = any(p_task_ids)
      and not exists (
        select 1 from public.tasks child
        where child.parent_id = task.id and child.id = any(p_task_ids)
      );
    get diagnostics v_deleted = row_count;
    exit when not exists (
      select 1 from public.tasks
      where project_id = p_project_id and id = any(p_task_ids)
    );
    if v_deleted = 0 then
      raise exception 'Não foi possível resolver a hierarquia selecionada.';
    end if;
  end loop;
end;
$$;

-- Status Report: criação, fluxo de aprovação, resumo e modelo restritos à gestão.
alter policy "managers manage reports" on public.status_reports
using (public.has_project_role(project_id, array['admin','manager']::public.project_role[]))
with check (public.has_project_role(project_id, array['admin','manager']::public.project_role[]));

alter policy "managers manage report items" on public.status_report_updates
using (exists (select 1 from public.status_reports r where r.id = report_id
  and public.has_project_role(r.project_id, array['admin','manager']::public.project_role[])))
with check (exists (select 1 from public.status_reports r where r.id = report_id
  and public.has_project_role(r.project_id, array['admin','manager']::public.project_role[])));

alter policy "managers manage templates" on public.report_templates
using (public.has_project_role(project_id, array['admin','manager']::public.project_role[]))
with check (public.has_project_role(project_id, array['admin','manager']::public.project_role[]));

alter policy "managers create report events" on public.status_report_events
with check (exists (select 1 from public.status_reports r where r.id = report_id
  and public.has_project_role(r.project_id, array['admin','manager']::public.project_role[])));

create or replace function public.transition_status_report(
  p_report_id uuid, p_status public.report_status, p_note text default null
) returns void language plpgsql security definer set search_path=''
as $$
declare v_project_id uuid; v_previous public.report_status;
begin
  select project_id,status into v_project_id,v_previous from public.status_reports where id=p_report_id for update;
  if not found then raise exception 'report not found'; end if;
  if not public.has_project_role(v_project_id,array['admin','manager']::public.project_role[]) then raise exception 'not allowed'; end if;
  update public.status_reports set status=p_status,review_note=nullif(trim(p_note),''),approved_by=case when p_status='approved' then auth.uid() else approved_by end,approved_at=case when p_status='approved' then now() else approved_at end,sent_at=case when p_status='sent' then now() else sent_at end where id=p_report_id;
  insert into public.status_report_events(report_id,from_status,to_status,note,created_by) values(p_report_id,v_previous,p_status,nullif(trim(p_note),''),auth.uid());
end $$;

-- Diário de Obra: registros alheios só podem ser alterados pela gestão.
-- (update_daily_progress e delete_daily_progress já validam autor ou admin/gestor.)
alter policy "field team updates daily logs" on public.daily_logs
using (created_by = auth.uid() or public.has_project_role(project_id, array['admin','manager']::public.project_role[]))
with check (public.has_project_role(project_id, array['admin','manager','engineer','foreman']::public.project_role[]));

alter policy "field manage update teams" on public.task_update_teams
using (exists (select 1 from public.task_updates u join public.daily_logs d on d.id = u.daily_log_id
  where u.id = update_id and (
    (u.created_by = auth.uid() and public.has_project_role(d.project_id, array['admin','manager','engineer','foreman']::public.project_role[]))
    or public.has_project_role(d.project_id, array['admin','manager']::public.project_role[]))))
with check (exists (select 1 from public.task_updates u join public.daily_logs d on d.id = u.daily_log_id
  where u.id = update_id and (
    (u.created_by = auth.uid() and public.has_project_role(d.project_id, array['admin','manager','engineer','foreman']::public.project_role[]))
    or public.has_project_role(d.project_id, array['admin','manager']::public.project_role[]))));

alter policy "field team creates photo metadata" on public.update_photos
with check (created_by = auth.uid() and exists (select 1 from public.task_updates u join public.daily_logs d on d.id = u.daily_log_id
  where u.id = update_id and (
    (u.created_by = auth.uid() and public.has_project_role(d.project_id, array['admin','manager','engineer','foreman']::public.project_role[]))
    or public.has_project_role(d.project_id, array['admin','manager']::public.project_role[]))));

-- Expõe o autor para a interface decidir quem pode editar/excluir cada registro.
create or replace view public.daily_report_feed
with (security_invoker = true)
as
select
  d.project_id, d.log_date, d.id as daily_log_id, u.id as update_id, u.task_id,
  t.wbs, t.name as task_name, t.phase, u.title, u.description,
  u.progress_before, u.progress_delta, u.progress_after, u.crew_count,
  u.weather, u.created_at, p.full_name as author_name,
  coalesce(
    jsonb_agg(jsonb_build_object(
      'id', ph.id, 'storage_path', ph.storage_path, 'caption', ph.caption,
      'taken_at', ph.taken_at, 'sort_order', ph.sort_order
    ) order by ph.sort_order) filter (where ph.id is not null),
    '[]'::jsonb
  ) as photos,
  u.created_by as author_id
from public.daily_logs d
join public.task_updates u on u.daily_log_id = d.id
join public.tasks t on t.id = u.task_id
join public.profiles p on p.id = u.created_by
left join public.update_photos ph on ph.update_id = u.id
group by d.project_id, d.log_date, d.id, u.id, t.wbs, t.name, t.phase, p.full_name;

grant select on public.daily_report_feed to authenticated;

notify pgrst, 'reload schema';
commit;
