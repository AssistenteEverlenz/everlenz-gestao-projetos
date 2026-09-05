-- Durações fracionadas e exclusão atômica de conjuntos do Gantt.
alter table public.tasks
  add column if not exists duration_days numeric(10,2);

alter table public.tasks
  alter column duration_days drop default,
  alter column duration_days drop not null;

alter table public.tasks
  drop constraint if exists tasks_duration_days_check;
alter table public.tasks
  add constraint tasks_duration_days_check check (duration_days > 0);

-- Views expandem `t.*` na criação; recriar expõe a nova coluna ao cliente.
drop view if exists public.project_gantt;
create view public.project_gantt
with (security_invoker = true)
as
select
  t.*, parent.wbs as parent_wbs, parent.name as parent_name,
  pred.wbs as predecessor_wbs, dep.dependency_type, dep.lag_days,
  coalesce(t.responsible_label, responsible.full_name) as responsible_name,
  pred.id as predecessor_id
from public.tasks t
left join public.tasks parent on parent.id = t.parent_id
left join public.task_dependencies dep on dep.successor_id = t.id
left join public.tasks pred on pred.id = dep.predecessor_id
left join public.profiles responsible on responsible.id = t.responsible_id;

grant select on public.project_gantt to authenticated;

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
    array['admin','manager','engineer']::public.project_role[]
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

revoke all on function public.delete_project_tasks(uuid, uuid[]) from public;
grant execute on function public.delete_project_tasks(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
