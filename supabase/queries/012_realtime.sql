-- Mantém cronograma, diário, relatórios e equipe sincronizados entre usuários.
do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'profiles',
    'projects',
    'project_members',
    'project_invitations',
    'tasks',
    'daily_logs',
    'update_photos',
    'status_reports'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end $$;

-- UPDATE e DELETE passam a carregar a linha anterior completa para o Realtime.
alter table public.profiles replica identity full;
alter table public.projects replica identity full;
alter table public.project_members replica identity full;
alter table public.project_invitations replica identity full;
alter table public.tasks replica identity full;
alter table public.daily_logs replica identity full;
alter table public.update_photos replica identity full;
alter table public.status_reports replica identity full;
