-- Acesso às obras por usuário.
-- O perfil (Administrador/Gestor/Usuário) passa a ser da conta, em profiles.account_role.
-- Administradores continuam com acesso automático a todas as obras da organização;
-- gestores e usuários veem somente as obras que criaram ou em que foram incluídos.
-- Quem escolhe as obras de cada pessoa é o administrador (todas) ou o gestor
-- (apenas as obras que ele mesmo acessa), pela rota /api/team.
begin;

alter table public.profiles add column if not exists account_role public.project_role;

-- Backfill: o maior papel que a pessoa já tem em alguma obra da própria organização.
update public.profiles u set account_role = coalesce((
  select case
    when bool_or(pm.role = 'admin') then 'admin'::public.project_role
    when bool_or(pm.role = 'manager') then 'manager'::public.project_role
    else 'engineer'::public.project_role end
  from public.project_members pm
  join public.projects p on p.id = pm.project_id and p.organization_id = u.organization_id
  where pm.user_id = u.id
), 'engineer'::public.project_role)
where u.account_role is null;

alter table public.profiles alter column account_role set default 'engineer';
alter table public.profiles alter column account_role set not null;

-- Papel e organização só mudam pelo servidor (service role) ou por funções SECURITY DEFINER.
create or replace function public.protect_profile_access_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and (
    new.account_role is distinct from old.account_role
    or new.organization_id is distinct from old.organization_id
  ) then
    raise exception 'Perfil de acesso e organização só podem ser alterados pela administração.';
  end if;
  return new;
end; $$;
drop trigger if exists protect_profile_access_columns on public.profiles;
create trigger protect_profile_access_columns before update on public.profiles
for each row execute function public.protect_profile_access_columns();

create or replace function public.current_account_role()
returns public.project_role language sql stable security definer set search_path = '' as $$
  select account_role from public.profiles where id = auth.uid()
$$;
revoke all on function public.current_account_role() from public, anon;
grant execute on function public.current_account_role() to authenticated;

-- Gestores deixam de entrar automaticamente em todas as obras.
-- Os vínculos já existentes são preservados; a partir de agora o acesso é escolhido por usuário.
drop trigger if exists sync_staff_project_access on public.project_members;
drop function if exists public.sync_staff_project_access();

-- Toda obra nova recebe apenas os administradores da conta.
create or replace function public.add_staff_to_new_project()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.project_members(project_id, user_id, role, accepted_at)
  select new.id, u.id, 'admin'::public.project_role, now()
  from public.profiles u
  where u.organization_id = new.organization_id
    and u.account_role = 'admin'
    and u.id <> new.created_by
  on conflict(project_id, user_id) do update set role = 'admin';
  return new;
end; $$;
revoke all on function public.add_staff_to_new_project() from public;

create or replace function public.can_create_organization_project(target_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select target_org = public.current_organization_id() and (
    not exists(select 1 from public.projects where organization_id = target_org)
    or public.current_account_role() in ('admin', 'manager')
  );
$$;

create or replace function public.create_organization(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and organization_id is not null) then
    raise exception 'user already belongs to an organization';
  end if;
  insert into public.organizations(name, slug) values (trim(p_name), lower(trim(p_slug))) returning id into v_org_id;
  update public.profiles set organization_id = v_org_id, account_role = 'admin' where id = auth.uid();
  return v_org_id;
end; $$;

create or replace function public.create_project_with_owner(
  p_name text, p_client_name text, p_address text, p_start_date date,
  p_planned_end_date date, p_contract_number text default null, p_description text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_project_id uuid; v_org_id uuid; v_role public.project_role;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select organization_id, account_role into v_org_id, v_role from public.profiles where id = auth.uid();
  if v_org_id is null then raise exception 'user does not belong to an organization'; end if;
  if v_role not in ('admin', 'manager') then
    if exists(select 1 from public.projects where organization_id = v_org_id) then
      raise exception 'Somente administradores e gestores podem criar projetos.';
    end if;
    -- Primeira obra de uma organização nova: o criador é o administrador da conta.
    v_role := 'admin';
    update public.profiles set account_role = 'admin' where id = auth.uid();
  end if;
  insert into public.projects(organization_id, name, client_name, address, start_date, planned_end_date, contract_number, description, created_by)
  values(v_org_id, trim(p_name), trim(p_client_name), trim(p_address), p_start_date, p_planned_end_date,
    nullif(trim(p_contract_number), ''), nullif(trim(p_description), ''), auth.uid())
  returning id into v_project_id;
  insert into public.project_members(project_id, user_id, role, accepted_at)
  values(v_project_id, auth.uid(), v_role, now())
  on conflict(project_id, user_id) do update set role = excluded.role;
  return v_project_id;
end; $$;

-- O papel dentro de uma obra é sempre o papel da conta, e só para pessoas da mesma organização.
alter policy "project creator adds owner" on public.project_members
with check (
  user_id = (select auth.uid())
  and role = (select public.current_account_role())
  and exists (select 1 from public.projects p where p.id = project_id and p.created_by = (select auth.uid()))
);

alter policy "managers manage memberships" on public.project_members
using (public.has_project_role(project_id, array['admin','manager']::public.project_role[]))
with check (
  public.has_project_role(project_id, array['admin','manager']::public.project_role[])
  and exists (
    select 1 from public.profiles u join public.projects p on p.id = project_id
    where u.id = user_id and u.organization_id = p.organization_id and u.account_role = role
  )
);

notify pgrst, 'reload schema';
commit;
