-- Administradores e gestores compartilham acesso somente dentro da organização.
begin;

create or replace function public.can_create_organization_project(target_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select target_org = public.current_organization_id() and (
    not exists(select 1 from public.projects where organization_id=target_org)
    or exists(select 1 from public.project_members pm join public.projects p on p.id=pm.project_id
      where p.organization_id=target_org and pm.user_id=auth.uid() and pm.role in ('admin','manager'))
  );
$$;
revoke all on function public.can_create_organization_project(uuid) from public;
grant execute on function public.can_create_organization_project(uuid) to authenticated;
alter policy "organization users create projects" on public.projects
with check(public.can_create_organization_project(organization_id) and created_by=auth.uid());

create or replace function public.sync_staff_project_access()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if pg_trigger_depth() > 1 or new.role not in ('admin','manager') then return new; end if;
  select p.organization_id into v_org from public.projects p
  join public.profiles u on u.id = new.user_id and u.organization_id = p.organization_id
  where p.id = new.project_id;
  if v_org is null then return new; end if;
  insert into public.project_members(project_id,user_id,role,accepted_at)
  select p.id,new.user_id,new.role,now() from public.projects p
  where p.organization_id = v_org and p.id <> new.project_id
  on conflict(project_id,user_id) do update set role = excluded.role;
  return new;
end; $$;
revoke all on function public.sync_staff_project_access() from public;

create or replace function public.add_staff_to_new_project()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.project_members(project_id,user_id,role,accepted_at)
  select new.id,pm.user_id,
    case when bool_or(pm.role = 'admin') then 'admin'::public.project_role else 'manager'::public.project_role end,now()
  from public.project_members pm
  join public.projects p on p.id = pm.project_id
  join public.profiles u on u.id = pm.user_id and u.organization_id = new.organization_id
  where p.organization_id = new.organization_id and pm.role in ('admin','manager')
    and pm.user_id <> new.created_by
  group by pm.user_id
  on conflict(project_id,user_id) do nothing;
  return new;
end; $$;
revoke all on function public.add_staff_to_new_project() from public;
create trigger add_staff_to_new_project after insert on public.projects
for each row execute function public.add_staff_to_new_project();

-- Backfill preserves existing ordinary-user memberships.
with staff as (
  select p.organization_id,pm.user_id,
    case when bool_or(pm.role = 'admin') then 'admin'::public.project_role else 'manager'::public.project_role end as role
  from public.project_members pm join public.projects p on p.id = pm.project_id
  join public.profiles u on u.id = pm.user_id and u.organization_id = p.organization_id
  where pm.role in ('admin','manager') group by p.organization_id,pm.user_id
)
insert into public.project_members(project_id,user_id,role,accepted_at)
select p.id,s.user_id,s.role,now() from staff s join public.projects p on p.organization_id=s.organization_id
on conflict(project_id,user_id) do update set role=excluded.role;

create trigger sync_staff_project_access after insert or update of role on public.project_members
for each row execute function public.sync_staff_project_access();

-- Creating a project must not promote ordinary users to account administrators.
create or replace function public.create_project_with_owner(
  p_name text,p_client_name text,p_address text,p_start_date date,
  p_planned_end_date date,p_contract_number text default null,p_description text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_project_id uuid; v_org_id uuid; v_role public.project_role;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select organization_id into v_org_id from public.profiles where id=auth.uid();
  if v_org_id is null then raise exception 'user does not belong to an organization'; end if;
  select pm.role into v_role from public.project_members pm join public.projects p on p.id=pm.project_id
  where pm.user_id=auth.uid() and p.organization_id=v_org_id and pm.role in ('admin','manager')
  order by (pm.role='admin') desc limit 1;
  if v_role is null and exists(select 1 from public.projects where organization_id=v_org_id) then
    raise exception 'Somente administradores e gestores podem criar projetos.';
  end if;
  v_role := coalesce(v_role,'admin'::public.project_role);
  insert into public.projects(organization_id,name,client_name,address,start_date,planned_end_date,contract_number,description,created_by)
  values(v_org_id,trim(p_name),trim(p_client_name),trim(p_address),p_start_date,p_planned_end_date,nullif(trim(p_contract_number),''),nullif(trim(p_description),''),auth.uid()) returning id into v_project_id;
  insert into public.project_members(project_id,user_id,role,accepted_at) values(v_project_id,auth.uid(),v_role,now());
  return v_project_id;
end; $$;
notify pgrst,'reload schema';
commit;
