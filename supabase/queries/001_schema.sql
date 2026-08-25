-- Em Dia · estrutura principal (executar em um projeto Supabase novo)
create extension if not exists pgcrypto;

create type public.project_role as enum ('admin', 'manager', 'engineer', 'foreman', 'client');
create type public.project_status as enum ('planning', 'active', 'paused', 'completed');
create type public.report_status as enum ('draft', 'review', 'approved', 'sent');
create type public.dependency_type as enum ('FS', 'SS', 'FF', 'SF');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  full_name text not null default '',
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  client_name text not null,
  contract_number text,
  description text,
  address text not null,
  start_date date not null,
  planned_end_date date not null,
  actual_end_date date,
  status public.project_status not null default 'planning',
  report_footer text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (planned_end_date >= start_date)
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
  parent_id uuid references public.tasks(id) on delete restrict,
  wbs text not null,
  name text not null,
  phase text not null default 'Sem etapa',
  notes text,
  planned_start date not null,
  planned_end date not null,
  baseline_start date,
  baseline_end date,
  actual_start date,
  actual_end date,
  progress numeric(5,2) not null default 0 check (progress between 0 and 100),
  weight numeric(10,4) not null default 1 check (weight > 0),
  responsible_id uuid references public.profiles(id) on delete set null,
  color varchar(7) not null default '#e98243',
  is_milestone boolean not null default false,
  is_critical boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, wbs),
  check (planned_end >= planned_start),
  check ((baseline_start is null and baseline_end is null) or (baseline_start is not null and baseline_end >= baseline_start)),
  check (color ~ '^#[0-9A-Fa-f]{6}$')
);

create table public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  predecessor_id uuid not null references public.tasks(id) on delete cascade,
  successor_id uuid not null references public.tasks(id) on delete cascade,
  dependency_type public.dependency_type not null default 'FS',
  lag_days integer not null default 0,
  unique (predecessor_id, successor_id),
  check (predecessor_id <> successor_id)
);

create table public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  log_date date not null,
  weather text,
  temperature numeric(4,1),
  crew_count integer not null default 0 check (crew_count >= 0),
  general_notes text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, log_date)
);

create table public.task_updates (
  id uuid primary key default gen_random_uuid(),
  daily_log_id uuid not null references public.daily_logs(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null,
  description text not null,
  progress_before numeric(5,2) not null check (progress_before between 0 and 100),
  progress_delta numeric(5,2) not null check (progress_delta between 0 and 100),
  progress_after numeric(5,2) not null check (progress_after between 0 and 100),
  crew_count integer not null default 0 check (crew_count >= 0),
  weather text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (progress_after = progress_before + progress_delta)
);

create table public.update_photos (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.task_updates(id) on delete cascade,
  storage_path text not null unique,
  original_name text,
  caption text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes > 0),
  taken_at timestamptz,
  latitude numeric(9,6),
  longitude numeric(9,6),
  sort_order integer not null default 0,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  category text not null default 'other',
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes > 0),
  description text,
  created_by uuid not null references public.profiles(id),
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
  updated_at timestamptz not null default now(),
  unique (project_id, report_date),
  unique (project_id, sequence)
);

create table public.status_report_updates (
  report_id uuid not null references public.status_reports(id) on delete cascade,
  update_id uuid not null references public.task_updates(id) on delete restrict,
  primary key (report_id, update_id)
);

create index profiles_organization_idx on public.profiles(organization_id);
create index project_members_user_idx on public.project_members(user_id, project_id);
create index projects_organization_idx on public.projects(organization_id, created_at desc);
create index tasks_project_sort_idx on public.tasks(project_id, sort_order, wbs);
create index tasks_parent_idx on public.tasks(parent_id);
create index dependencies_successor_idx on public.task_dependencies(successor_id);
create index daily_logs_project_date_idx on public.daily_logs(project_id, log_date desc);
create index task_updates_log_idx on public.task_updates(daily_log_id, created_at);
create index task_updates_task_idx on public.task_updates(task_id, created_at desc);
create index update_photos_update_idx on public.update_photos(update_id, sort_order);
create index project_files_project_idx on public.project_files(project_id, created_at desc);
create index reports_project_date_idx on public.status_reports(project_id, report_date desc);
