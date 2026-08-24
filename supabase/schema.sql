-- Em Dia · by Everlenz · estrutura inicial multiusuário
create extension if not exists pgcrypto;

create type public.project_role as enum ('admin', 'manager', 'engineer', 'foreman', 'client');
create type public.project_status as enum ('planning', 'active', 'paused', 'completed');
create type public.report_status as enum ('draft', 'review', 'approved', 'sent');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  client_name text not null,
  address text,
  start_date date not null,
  planned_end_date date not null,
  actual_end_date date,
  status public.project_status not null default 'planning',
  report_footer text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.project_role not null default 'engineer',
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (project_id, user_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id uuid references public.tasks(id) on delete cascade,
  wbs text not null,
  name text not null,
  phase text,
  planned_start date not null,
  planned_end date not null,
  baseline_start date,
  baseline_end date,
  actual_start date,
  actual_end date,
  progress numeric(5,2) not null default 0 check (progress between 0 and 100),
  weight numeric(8,4) not null default 1 check (weight > 0),
  responsible_id uuid references public.profiles(id),
  is_milestone boolean not null default false,
  is_critical boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, wbs)
);

create table public.task_dependencies (
  predecessor_id uuid not null references public.tasks(id) on delete cascade,
  successor_id uuid not null references public.tasks(id) on delete cascade,
  dependency_type text not null default 'FS' check (dependency_type in ('FS', 'SS', 'FF', 'SF')),
  lag_days integer not null default 0,
  primary key (predecessor_id, successor_id),
  check (predecessor_id <> successor_id)
);

create table public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  log_date date not null,
  weather text,
  temperature numeric(4,1),
  crew_count integer not null default 0 check (crew_count >= 0),
  notes text,
  is_approved boolean not null default false,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (project_id, log_date)
);

create table public.task_updates (
  id uuid primary key default gen_random_uuid(),
  daily_log_id uuid not null references public.daily_logs(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null,
  description text not null,
  previous_progress numeric(5,2) not null,
  new_progress numeric(5,2) not null check (new_progress between 0 and 100),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.update_photos (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.task_updates(id) on delete cascade,
  storage_path text not null,
  caption text,
  taken_at timestamptz,
  latitude numeric(9,6),
  longitude numeric(9,6),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.status_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  report_date date not null,
  sequence integer not null,
  status public.report_status not null default 'draft',
  executive_summary text,
  overall_progress numeric(5,2) not null default 0,
  planned_progress numeric(5,2) not null default 0,
  pdf_storage_path text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  sent_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (project_id, report_date),
  unique (project_id, sequence)
);

create index tasks_project_sort_idx on public.tasks(project_id, sort_order);
create index daily_logs_project_date_idx on public.daily_logs(project_id, log_date desc);
create index task_updates_log_idx on public.task_updates(daily_log_id, created_at);
create index reports_project_date_idx on public.status_reports(project_id, report_date desc);

create or replace function public.is_project_member(target_project_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.project_members pm where pm.project_id = target_project_id and pm.user_id = auth.uid()) $$;

create or replace function public.can_manage_project(target_project_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.project_members pm where pm.project_id = target_project_id and pm.user_id = auth.uid() and pm.role in ('admin','manager')) $$;

create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path = public
as $$ select organization_id from public.profiles where id = auth.uid() $$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.daily_logs enable row level security;
alter table public.task_updates enable row level security;
alter table public.update_photos enable row level security;
alter table public.status_reports enable row level security;

create policy "organization members read organization" on public.organizations for select using (id = public.current_organization_id());
create policy "organization members read profiles" on public.profiles for select using (organization_id = public.current_organization_id());
create policy "users update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "members read projects" on public.projects for select using (public.is_project_member(id));
create policy "managers update projects" on public.projects for update using (public.can_manage_project(id));
create policy "members read project members" on public.project_members for select using (public.is_project_member(project_id));
create policy "managers manage project members" on public.project_members for all using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));
create policy "members read tasks" on public.tasks for select using (public.is_project_member(project_id));
create policy "project staff manage tasks" on public.tasks for all using (exists (select 1 from public.project_members pm where pm.project_id = tasks.project_id and pm.user_id = auth.uid() and pm.role in ('admin','manager','engineer'))) with check (exists (select 1 from public.project_members pm where pm.project_id = tasks.project_id and pm.user_id = auth.uid() and pm.role in ('admin','manager','engineer')));
create policy "members read dependencies" on public.task_dependencies for select using (exists (select 1 from public.tasks t where t.id = predecessor_id and public.is_project_member(t.project_id)));
create policy "staff manage dependencies" on public.task_dependencies for all using (exists (select 1 from public.tasks t where t.id = predecessor_id and public.can_manage_project(t.project_id)));
create policy "members read daily logs" on public.daily_logs for select using (public.is_project_member(project_id));
create policy "field team manages daily logs" on public.daily_logs for all using (exists (select 1 from public.project_members pm where pm.project_id = daily_logs.project_id and pm.user_id = auth.uid() and pm.role in ('admin','manager','engineer','foreman'))) with check (exists (select 1 from public.project_members pm where pm.project_id = daily_logs.project_id and pm.user_id = auth.uid() and pm.role in ('admin','manager','engineer','foreman')));
create policy "members read task updates" on public.task_updates for select using (exists (select 1 from public.daily_logs d where d.id = daily_log_id and public.is_project_member(d.project_id)));
create policy "field team manages task updates" on public.task_updates for all using (exists (select 1 from public.daily_logs d join public.project_members pm on pm.project_id = d.project_id where d.id = daily_log_id and pm.user_id = auth.uid() and pm.role in ('admin','manager','engineer','foreman')));
create policy "members read photos" on public.update_photos for select using (exists (select 1 from public.task_updates u join public.daily_logs d on d.id = u.daily_log_id where u.id = update_id and public.is_project_member(d.project_id)));
create policy "field team manages photos" on public.update_photos for all using (exists (select 1 from public.task_updates u join public.daily_logs d on d.id = u.daily_log_id join public.project_members pm on pm.project_id = d.project_id where u.id = update_id and pm.user_id = auth.uid() and pm.role in ('admin','manager','engineer','foreman')));
create policy "members read reports" on public.status_reports for select using (public.is_project_member(project_id));
create policy "managers manage reports" on public.status_reports for all using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

-- O bucket privado `worksite-photos` deve ser criado no Storage. Os caminhos
-- devem seguir: organization_id/project_id/YYYY-MM-DD/update_id/arquivo.jpg.
