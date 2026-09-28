-- Gravação do cronograma em lote.
--
-- Antes, reprogramar datas fazia uma requisição por atividade e reordenar a EAP
-- fazia duas, então um cronograma de 78 atividades custava ~156 idas ao servidor.
-- Além disso os gatilhos rodavam por linha: o de período varria todas as
-- atividades do projeto a cada linha alterada, e o de progresso disparava mesmo
-- quando a reordenação regravava parent_id com o mesmo valor, cascateando pela
-- hierarquia. Uma edição virava 317 updates.
--
-- As funções abaixo recebem o cronograma inteiro em um jsonb e resolvem tudo em
-- uma transação. São security invoker de propósito: o RLS de public.tasks segue
-- valendo igual, sem alargar nem estreitar quem pode editar.
--
-- Pode ser executada de novo com segurança.
begin;

-- Reprograma datas de várias atividades de uma vez.
create or replace function public.update_project_task_schedule(
  p_project_id uuid,
  p_tasks jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.tasks t
     set planned_start = v.planned_start,
         planned_end = v.planned_end,
         duration_days = v.duration_days,
         baseline_start = v.baseline_start,
         baseline_end = v.baseline_end
    from jsonb_to_recordset(p_tasks) as v(
      id uuid,
      planned_start date,
      planned_end date,
      duration_days numeric,
      baseline_start date,
      baseline_end date
    )
   where t.id = v.id
     and t.project_id = p_project_id;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.update_project_task_schedule(uuid, jsonb) from public;
grant execute on function public.update_project_task_schedule(uuid, jsonb) to authenticated;

-- Reordena a EAP inteira. Continuam duas passadas porque (project_id, wbs) é
-- único e não adiável, mas agora ambas acontecem na mesma transação, sem rede.
create or replace function public.reorder_project_tasks(
  p_project_id uuid,
  p_tasks jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated integer;
begin
  -- Passada 1: wbs temporário, para não colidir com os códigos ainda não trocados.
  update public.tasks t
     set wbs = 'tmp-' || t.id::text,
         parent_id = v.parent_id,
         sort_order = v.sort_order
    from jsonb_to_recordset(p_tasks) as v(
      id uuid,
      parent_id uuid,
      sort_order integer
    )
   where t.id = v.id
     and t.project_id = p_project_id;

  -- Passada 2: códigos definitivos e datas.
  update public.tasks t
     set wbs = v.wbs,
         planned_start = v.planned_start,
         planned_end = v.planned_end,
         duration_days = v.duration_days,
         baseline_start = v.baseline_start,
         baseline_end = v.baseline_end
    from jsonb_to_recordset(p_tasks) as v(
      id uuid,
      wbs text,
      planned_start date,
      planned_end date,
      duration_days numeric,
      baseline_start date,
      baseline_end date
    )
   where t.id = v.id
     and t.project_id = p_project_id;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.reorder_project_tasks(uuid, jsonb) from public;
grant execute on function public.reorder_project_tasks(uuid, jsonb) to authenticated;

-- Período do projeto: uma agregação por comando, não mais uma por linha.
create or replace function public.sync_project_period_from_tasks()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_projects uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct project_id) into v_projects from new_tasks;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct project_id) into v_projects from old_tasks;
  else
    -- Tabelas de transição não convivem com lista de colunas no gatilho, então o
    -- filtro por mudança de data vive aqui. Escrever a mesma data não faz nada.
    select array_agg(distinct p) into v_projects
      from (
        select n.project_id as p
          from new_tasks n join old_tasks o on o.id = n.id
         where (n.planned_start, n.planned_end, n.project_id)
               is distinct from (o.planned_start, o.planned_end, o.project_id)
        union
        select o.project_id
          from new_tasks n join old_tasks o on o.id = n.id
         where (n.planned_start, n.planned_end, n.project_id)
               is distinct from (o.planned_start, o.planned_end, o.project_id)
      ) u;
  end if;

  if v_projects is null then
    return null;
  end if;

  update public.projects p
     set start_date = s.first_start, planned_end_date = s.last_end
    from (
      select t.project_id,
             min(t.planned_start) as first_start,
             max(t.planned_end) as last_end
        from public.tasks t
       where t.project_id = any(v_projects)
       group by t.project_id
    ) s
   where p.id = s.project_id
     and s.first_start is not null
     and (p.start_date, p.planned_end_date) is distinct from (s.first_start, s.last_end);
  return null;
end $$;
revoke all on function public.sync_project_period_from_tasks() from public;

-- Tabelas de transição exigem um gatilho por evento.
drop trigger if exists sync_project_period_from_tasks on public.tasks;
drop trigger if exists sync_project_period_after_insert on public.tasks;
drop trigger if exists sync_project_period_after_update on public.tasks;
drop trigger if exists sync_project_period_after_delete on public.tasks;

create trigger sync_project_period_after_insert
after insert on public.tasks
referencing new table as new_tasks
for each statement execute function public.sync_project_period_from_tasks();

create trigger sync_project_period_after_update
after update on public.tasks
referencing new table as new_tasks old table as old_tasks
for each statement execute function public.sync_project_period_from_tasks();

create trigger sync_project_period_after_delete
after delete on public.tasks
referencing old table as old_tasks
for each statement execute function public.sync_project_period_from_tasks();

-- Progresso do item-pai: só recalcula quando algo realmente mudou de valor.
-- Regravar parent_id igual (o que a reordenação faz) deixa de disparar a cascata,
-- e a subida pela hierarquia para sozinha quando o progresso do pai não muda.
drop trigger if exists tasks_recalculate_parent_after_update on public.tasks;
create trigger tasks_recalculate_parent_after_update
after update of progress, weight, parent_id on public.tasks
for each row
when (
  new.parent_id is not null
  and (
    new.progress is distinct from old.progress
    or new.weight is distinct from old.weight
    or new.parent_id is distinct from old.parent_id
  )
)
execute function public.recalculate_parent_progress();

notify pgrst, 'reload schema';
commit;
