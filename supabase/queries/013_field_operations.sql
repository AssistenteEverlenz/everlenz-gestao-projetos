-- Operacao de campo: equipes terceirizadas, estoque por EAP, pontos de atencao
-- e rastreabilidade do fluxo de aprovacao dos relatorios.
create type public.issue_category as enum ('schedule','stock','field','quality','safety','other');
create type public.issue_priority as enum ('low','medium','high','critical');
create type public.issue_status as enum ('open','monitoring','resolved');
create type public.stock_movement_type as enum ('entry','exit','adjustment');

create table public.project_teams (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  company text not null,
  specialty text not null,
  contact text,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_update_teams (
  update_id uuid not null references public.task_updates(id) on delete cascade,
  team_id uuid not null references public.project_teams(id) on delete restrict,
  worker_count integer not null default 0 check (worker_count >= 0),
  primary key(update_id, team_id)
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  category text not null default 'Geral',
  sku text,
  unit text not null default 'un',
  current_quantity numeric(14,3) not null default 0 check (current_quantity >= 0),
  minimum_quantity numeric(14,3) not null default 0 check (minimum_quantity >= 0),
  lead_days integer not null default 0 check (lead_days >= 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inventory_allocations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  planned_quantity numeric(14,3) not null check (planned_quantity > 0),
  consumed_quantity numeric(14,3) not null default 0 check (consumed_quantity >= 0),
  created_at timestamptz not null default now(),
  unique(item_id, task_id),
  check (consumed_quantity <= planned_quantity)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  movement_type public.stock_movement_type not null,
  quantity numeric(14,3) not null check (quantity >= 0),
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.project_issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  category public.issue_category not null default 'other',
  priority public.issue_priority not null default 'medium',
  status public.issue_status not null default 'open',
  title text not null,
  description text not null default '',
  due_date date,
  resolved_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.report_templates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  settings jsonb not null default '{"showSummary":true,"showPhotos":true,"showGantt":true,"showSCurve":true,"showAttention":true,"photoSize":"large","compact":false}'::jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.status_report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.status_reports(id) on delete cascade,
  from_status public.report_status,
  to_status public.report_status not null,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.status_reports add column if not exists review_note text;
alter table public.project_teams enable row level security;
alter table public.task_update_teams enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_allocations enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.project_issues enable row level security;
alter table public.report_templates enable row level security;
alter table public.status_report_events enable row level security;

create policy "members read project teams" on public.project_teams for select to authenticated using (public.is_project_member(project_id));
create policy "staff manage project teams" on public.project_teams for all to authenticated using (public.has_project_role(project_id,array['admin','manager','engineer']::public.project_role[])) with check (public.has_project_role(project_id,array['admin','manager','engineer']::public.project_role[]));
create policy "members read update teams" on public.task_update_teams for select to authenticated using (exists(select 1 from public.task_updates u join public.daily_logs d on d.id=u.daily_log_id where u.id=update_id and public.is_project_member(d.project_id)));
create policy "field manage update teams" on public.task_update_teams for all to authenticated using (exists(select 1 from public.task_updates u join public.daily_logs d on d.id=u.daily_log_id where u.id=update_id and public.has_project_role(d.project_id,array['admin','manager','engineer','foreman']::public.project_role[]))) with check (exists(select 1 from public.task_updates u join public.daily_logs d on d.id=u.daily_log_id where u.id=update_id and public.has_project_role(d.project_id,array['admin','manager','engineer','foreman']::public.project_role[])));
create policy "members read inventory" on public.inventory_items for select to authenticated using (public.is_project_member(project_id));
create policy "staff manage inventory" on public.inventory_items for all to authenticated using (public.has_project_role(project_id,array['admin','manager','engineer']::public.project_role[])) with check (public.has_project_role(project_id,array['admin','manager','engineer']::public.project_role[]));
create policy "members read allocations" on public.inventory_allocations for select to authenticated using (exists(select 1 from public.inventory_items i where i.id=item_id and public.is_project_member(i.project_id)));
create policy "staff manage allocations" on public.inventory_allocations for all to authenticated using (exists(select 1 from public.inventory_items i where i.id=item_id and public.has_project_role(i.project_id,array['admin','manager','engineer']::public.project_role[]))) with check (exists(select 1 from public.inventory_items i where i.id=item_id and public.has_project_role(i.project_id,array['admin','manager','engineer']::public.project_role[])));
create policy "members read movements" on public.inventory_movements for select to authenticated using (exists(select 1 from public.inventory_items i where i.id=item_id and public.is_project_member(i.project_id)));
create policy "staff create movements" on public.inventory_movements for insert to authenticated with check (exists(select 1 from public.inventory_items i where i.id=item_id and public.has_project_role(i.project_id,array['admin','manager','engineer','foreman']::public.project_role[])));
create policy "members read issues" on public.project_issues for select to authenticated using (public.is_project_member(project_id));
create policy "field manage issues" on public.project_issues for all to authenticated using (public.has_project_role(project_id,array['admin','manager','engineer','foreman']::public.project_role[])) with check (public.has_project_role(project_id,array['admin','manager','engineer','foreman']::public.project_role[]));
create policy "members read templates" on public.report_templates for select to authenticated using (public.is_project_member(project_id));
create policy "managers manage templates" on public.report_templates for all to authenticated using (public.has_project_role(project_id,array['admin','manager','engineer']::public.project_role[])) with check (public.has_project_role(project_id,array['admin','manager','engineer']::public.project_role[]));
create policy "members read report events" on public.status_report_events for select to authenticated using (exists(select 1 from public.status_reports r where r.id=report_id and public.is_project_member(r.project_id)));
create policy "managers create report events" on public.status_report_events for insert to authenticated with check (exists(select 1 from public.status_reports r where r.id=report_id and public.has_project_role(r.project_id,array['admin','manager','engineer']::public.project_role[])));

create trigger project_teams_touch before update on public.project_teams for each row execute function public.touch_updated_at();
create trigger inventory_items_touch before update on public.inventory_items for each row execute function public.touch_updated_at();
create trigger project_issues_touch before update on public.project_issues for each row execute function public.touch_updated_at();
create trigger report_templates_touch before update on public.report_templates for each row execute function public.touch_updated_at();

create or replace function public.move_inventory(
  p_item_id uuid, p_type public.stock_movement_type, p_quantity numeric,
  p_task_id uuid default null, p_note text default null
) returns numeric language plpgsql security definer set search_path=''
as $$
declare v_project_id uuid; v_current numeric; v_next numeric;
begin
  select project_id,current_quantity into v_project_id,v_current from public.inventory_items where id=p_item_id for update;
  if not found then raise exception 'inventory item not found'; end if;
  if not public.has_project_role(v_project_id,array['admin','manager','engineer','foreman']::public.project_role[]) then raise exception 'not allowed'; end if;
  v_next := case when p_type='entry' then v_current+p_quantity when p_type='exit' then v_current-p_quantity else p_quantity end;
  if v_next < 0 then raise exception 'insufficient stock'; end if;
  update public.inventory_items set current_quantity=v_next where id=p_item_id;
  insert into public.inventory_movements(item_id,task_id,movement_type,quantity,note,created_by) values(p_item_id,p_task_id,p_type,p_quantity,p_note,auth.uid());
  if p_type='exit' and p_task_id is not null then
    update public.inventory_allocations set consumed_quantity=least(planned_quantity,consumed_quantity+p_quantity) where item_id=p_item_id and task_id=p_task_id;
  end if;
  return v_next;
end $$;

create or replace function public.transition_status_report(
  p_report_id uuid, p_status public.report_status, p_note text default null
) returns void language plpgsql security definer set search_path=''
as $$
declare v_project_id uuid; v_previous public.report_status;
begin
  select project_id,status into v_project_id,v_previous from public.status_reports where id=p_report_id for update;
  if not public.has_project_role(v_project_id,array['admin','manager','engineer']::public.project_role[]) then raise exception 'not allowed'; end if;
  update public.status_reports set status=p_status,review_note=nullif(trim(p_note),''),approved_by=case when p_status='approved' then auth.uid() else approved_by end,approved_at=case when p_status='approved' then now() else approved_at end,sent_at=case when p_status='sent' then now() else sent_at end where id=p_report_id;
  insert into public.status_report_events(report_id,from_status,to_status,note,created_by) values(p_report_id,v_previous,p_status,nullif(trim(p_note),''),auth.uid());
end $$;

revoke execute on function public.move_inventory(uuid,public.stock_movement_type,numeric,uuid,text) from public,anon;
revoke execute on function public.transition_status_report(uuid,public.report_status,text) from public,anon;
grant execute on function public.move_inventory(uuid,public.stock_movement_type,numeric,uuid,text) to authenticated;
grant execute on function public.transition_status_report(uuid,public.report_status,text) to authenticated;

do $$ declare t text; begin foreach t in array array['task_updates','project_teams','task_update_teams','inventory_items','inventory_allocations','inventory_movements','project_issues','report_templates','status_report_events'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t); end if;
end loop; end $$;
