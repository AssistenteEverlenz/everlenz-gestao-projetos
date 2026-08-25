-- Segurança multiusuário por organização, projeto e função.
create or replace function public.is_project_member(target_project_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.project_members pm where pm.project_id = target_project_id and pm.user_id = auth.uid()) $$;

create or replace function public.has_project_role(target_project_id uuid, allowed_roles public.project_role[])
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.project_members pm where pm.project_id = target_project_id and pm.user_id = auth.uid() and pm.role = any(allowed_roles)) $$;

create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path = ''
as $$ select p.organization_id from public.profiles p where p.id = auth.uid() $$;

revoke execute on function public.is_project_member(uuid) from public, anon;
revoke execute on function public.has_project_role(uuid,public.project_role[]) from public, anon;
revoke execute on function public.current_organization_id() from public, anon;
grant execute on function public.is_project_member(uuid) to authenticated;
grant execute on function public.has_project_role(uuid,public.project_role[]) to authenticated;
grant execute on function public.current_organization_id() to authenticated;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.daily_logs enable row level security;
alter table public.task_updates enable row level security;
alter table public.update_photos enable row level security;
alter table public.project_files enable row level security;
alter table public.status_reports enable row level security;
alter table public.status_report_updates enable row level security;

create policy "authenticated create organization" on public.organizations for insert to authenticated with check (true);
create policy "organization members read organization" on public.organizations for select to authenticated using (id = (select public.current_organization_id()));
create policy "organization admins update organization" on public.organizations for update to authenticated using (id = (select public.current_organization_id()) and exists (select 1 from public.project_members pm where pm.user_id = auth.uid() and pm.role = 'admin'));

create policy "users read same organization profiles" on public.profiles for select to authenticated using (id = auth.uid() or organization_id = (select public.current_organization_id()));
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "members read projects" on public.projects for select to authenticated using (public.is_project_member(id));
create policy "organization users create projects" on public.projects for insert to authenticated with check (organization_id = (select public.current_organization_id()) and created_by = auth.uid());
create policy "managers update projects" on public.projects for update to authenticated using (public.has_project_role(id, array['admin','manager']::public.project_role[]));
create policy "admins delete projects" on public.projects for delete to authenticated using (public.has_project_role(id, array['admin']::public.project_role[]));

create policy "members read memberships" on public.project_members for select to authenticated using (public.is_project_member(project_id) or user_id = auth.uid());
create policy "project creator adds owner" on public.project_members for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.created_by = auth.uid()));
create policy "managers manage memberships" on public.project_members for all to authenticated using (public.has_project_role(project_id, array['admin','manager']::public.project_role[])) with check (public.has_project_role(project_id, array['admin','manager']::public.project_role[]));

create policy "members read tasks" on public.tasks for select to authenticated using (public.is_project_member(project_id));
create policy "planning team manages tasks" on public.tasks for all to authenticated using (public.has_project_role(project_id, array['admin','manager','engineer']::public.project_role[])) with check (public.has_project_role(project_id, array['admin','manager','engineer']::public.project_role[]));

create policy "members read dependencies" on public.task_dependencies for select to authenticated using (exists (select 1 from public.tasks t where t.id = predecessor_id and public.is_project_member(t.project_id)));
create policy "planning team manages dependencies" on public.task_dependencies for all to authenticated using (exists (select 1 from public.tasks t where t.id = predecessor_id and public.has_project_role(t.project_id, array['admin','manager','engineer']::public.project_role[]))) with check (exists (select 1 from public.tasks t where t.id = predecessor_id and public.has_project_role(t.project_id, array['admin','manager','engineer']::public.project_role[])));

create policy "members read daily logs" on public.daily_logs for select to authenticated using (public.is_project_member(project_id));
create policy "field team creates daily logs" on public.daily_logs for insert to authenticated with check (public.has_project_role(project_id, array['admin','manager','engineer','foreman']::public.project_role[]) and created_by = auth.uid());
create policy "field team updates daily logs" on public.daily_logs for update to authenticated using (public.has_project_role(project_id, array['admin','manager','engineer','foreman']::public.project_role[])) with check (public.has_project_role(project_id, array['admin','manager','engineer','foreman']::public.project_role[]));

create policy "members read task updates" on public.task_updates for select to authenticated using (exists (select 1 from public.daily_logs d where d.id = daily_log_id and public.is_project_member(d.project_id)));
create policy "field team creates task updates" on public.task_updates for insert to authenticated with check (created_by = auth.uid() and exists (select 1 from public.daily_logs d where d.id = daily_log_id and public.has_project_role(d.project_id, array['admin','manager','engineer','foreman']::public.project_role[])));
create policy "authors and managers update task updates" on public.task_updates for update to authenticated using (created_by = auth.uid() or exists (select 1 from public.daily_logs d where d.id = daily_log_id and public.has_project_role(d.project_id, array['admin','manager']::public.project_role[])));

create policy "members read photo metadata" on public.update_photos for select to authenticated using (exists (select 1 from public.task_updates u join public.daily_logs d on d.id = u.daily_log_id where u.id = update_id and public.is_project_member(d.project_id)));
create policy "field team creates photo metadata" on public.update_photos for insert to authenticated with check (created_by = auth.uid() and exists (select 1 from public.task_updates u join public.daily_logs d on d.id = u.daily_log_id where u.id = update_id and public.has_project_role(d.project_id, array['admin','manager','engineer','foreman']::public.project_role[])));
create policy "authors delete photo metadata" on public.update_photos for delete to authenticated using (created_by = auth.uid());

create policy "members read project files" on public.project_files for select to authenticated using (public.is_project_member(project_id));
create policy "staff manages project files" on public.project_files for all to authenticated using (public.has_project_role(project_id, array['admin','manager','engineer']::public.project_role[])) with check (public.has_project_role(project_id, array['admin','manager','engineer']::public.project_role[]) and created_by = auth.uid());

create policy "members read reports" on public.status_reports for select to authenticated using (public.is_project_member(project_id));
create policy "managers manage reports" on public.status_reports for all to authenticated using (public.has_project_role(project_id, array['admin','manager','engineer']::public.project_role[])) with check (public.has_project_role(project_id, array['admin','manager','engineer']::public.project_role[]));
create policy "members read report items" on public.status_report_updates for select to authenticated using (exists (select 1 from public.status_reports r where r.id = report_id and public.is_project_member(r.project_id)));
create policy "managers manage report items" on public.status_report_updates for all to authenticated using (exists (select 1 from public.status_reports r where r.id = report_id and public.has_project_role(r.project_id, array['admin','manager','engineer']::public.project_role[])));
