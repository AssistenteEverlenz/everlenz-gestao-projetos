-- O período do projeto passa a acompanhar o cronograma e ganha um prazo máximo.
-- start_date/planned_end_date = primeiro início e último término das atividades;
-- deadline_date = prazo máximo contratual (inicialmente o término digitado na criação).
begin;

alter table public.projects add column if not exists deadline_date date;
update public.projects set deadline_date = planned_end_date where deadline_date is null;

create or replace function public.sync_project_period_from_tasks()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
begin
  update public.projects p
     set start_date = s.first_start, planned_end_date = s.last_end
    from (
      select min(t.planned_start) as first_start, max(t.planned_end) as last_end
        from public.tasks t where t.project_id = v_project
    ) s
   where p.id = v_project
     and s.first_start is not null
     and (p.start_date, p.planned_end_date) is distinct from (s.first_start, s.last_end);
  return null;
end $$;
revoke all on function public.sync_project_period_from_tasks() from public;

drop trigger if exists sync_project_period_from_tasks on public.tasks;
create trigger sync_project_period_from_tasks
after insert or delete or update of planned_start, planned_end on public.tasks
for each row execute function public.sync_project_period_from_tasks();

-- Alinha os projetos que já têm cronograma.
update public.projects p
   set start_date = s.first_start, planned_end_date = s.last_end
  from (
    select t.project_id, min(t.planned_start) as first_start, max(t.planned_end) as last_end
      from public.tasks t group by t.project_id
  ) s
 where p.id = s.project_id
   and (p.start_date, p.planned_end_date) is distinct from (s.first_start, s.last_end);

notify pgrst, 'reload schema';
commit;
