-- Portfólio de projetos e responsáveis operacionais do cronograma.
alter table public.projects
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id);

alter table public.tasks
  add column if not exists responsible_kind text,
  add column if not exists responsible_ref_id uuid,
  add column if not exists responsible_label text;

alter table public.tasks drop constraint if exists tasks_responsible_kind_check;
alter table public.tasks add constraint tasks_responsible_kind_check
  check (responsible_kind is null or responsible_kind in ('user','team','worker'));

update public.tasks t
set responsible_kind = 'user',
    responsible_ref_id = t.responsible_id,
    responsible_label = p.full_name
from public.profiles p
where t.responsible_id = p.id
  and t.responsible_kind is null;

create index if not exists projects_archived_at_idx
  on public.projects(organization_id, archived_at, created_at desc);

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

create or replace function public.set_project_archived(
  p_project_id uuid,
  p_archived boolean
) returns void
language plpgsql security definer set search_path=public
as $$
begin
  if not public.has_project_role(
    p_project_id,
    array['admin','manager']::public.project_role[]
  ) then
    raise exception 'sem permissão para arquivar este projeto';
  end if;

  update public.projects
  set archived_at = case when p_archived then now() else null end,
      archived_by = case when p_archived then auth.uid() else null end,
      updated_at = now()
  where id = p_project_id;
end;
$$;

revoke execute on function public.set_project_archived(uuid,boolean) from public,anon;
grant execute on function public.set_project_archived(uuid,boolean) to authenticated;
