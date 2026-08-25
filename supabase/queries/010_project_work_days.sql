alter table public.projects add column if not exists work_days smallint[] not null default array[1,2,3,4,5]::smallint[];
alter table public.projects drop constraint if exists projects_work_days_valid;
alter table public.projects add constraint projects_work_days_valid check (
  cardinality(work_days) > 0 and work_days <@ array[0,1,2,3,4,5,6]::smallint[]
);
