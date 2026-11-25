-- Acesso às obras por usuário (migration 025).
-- Rode dentro de uma transação e faça ROLLBACK; precisa de uma organização com
-- um administrador, um gestor e um usuário.
do $$
declare v_org uuid; v_admin uuid; v_manager uuid; v_user uuid; v_new uuid; v_other uuid; v_count bigint;
begin
  select organization_id into v_org from public.profiles
  where account_role = 'manager' and organization_id is not null limit 1;
  select id into v_admin from public.profiles where organization_id = v_org and account_role = 'admin' limit 1;
  select id into v_manager from public.profiles where organization_id = v_org and account_role = 'manager' limit 1;
  select id into v_user from public.profiles where organization_id = v_org and account_role = 'engineer' limit 1;
  if v_admin is null or v_manager is null or v_user is null then raise exception 'Faltam dados de teste'; end if;

  -- Obra criada pelo gestor: entra o gestor e os administradores, mais ninguém.
  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  if not public.can_create_organization_project(v_org) then raise exception 'Gestor não consegue criar obra'; end if;
  v_new := public.create_project_with_owner('TEST ROLLBACK', 'TEST', 'TEST', current_date, current_date);
  if not exists(select 1 from public.project_members where project_id = v_new and user_id = v_manager and role = 'manager') then
    raise exception 'Gestor criador sem acesso de gestor à própria obra';
  end if;
  if not exists(select 1 from public.project_members where project_id = v_new and user_id = v_admin and role = 'admin') then
    raise exception 'Administrador não entrou na obra nova';
  end if;
  if exists(select 1 from public.project_members pm join public.profiles u on u.id = pm.user_id
    where pm.project_id = v_new and u.account_role = 'manager' and pm.user_id <> v_manager) then
    raise exception 'Outro gestor recebeu a obra nova automaticamente';
  end if;
  if exists(select 1 from public.project_members where project_id = v_new and user_id = v_user) then
    raise exception 'Usuário recebeu a obra nova automaticamente';
  end if;

  -- Liberar uma obra (ou promover a gestor) não espalha o acesso para as outras.
  select count(*) into v_count from public.project_members where user_id = v_user;
  insert into public.project_members(project_id, user_id, role, accepted_at)
  values(v_new, v_user, 'engineer', now());
  if (select count(*) from public.project_members where user_id = v_user) <> v_count + 1 then
    raise exception 'Liberar uma obra alterou o acesso a outras obras';
  end if;
  update public.profiles set account_role = 'manager' where id = v_user;
  update public.project_members set role = 'manager' where user_id = v_user and project_id = v_new;
  if (select count(*) from public.project_members where user_id = v_user) <> v_count + 1 then
    raise exception 'Promover a gestor espalhou o acesso para todas as obras';
  end if;
  update public.project_members set role = 'engineer' where user_id = v_user and project_id = v_new;
  update public.profiles set account_role = 'engineer' where id = v_user;

  -- Usuário comum não cria obra.
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  if public.can_create_organization_project(v_org) then raise exception 'Usuário consegue criar obra'; end if;

  -- O navegador não troca o próprio perfil nem a organização.
  begin
    set local role authenticated;
    update public.profiles set account_role = 'admin' where id = v_user;
    reset role;
    raise exception 'Usuário promoveu o próprio perfil';
  exception when others then
    reset role;
    if sqlerrm = 'Usuário promoveu o próprio perfil' then raise; end if;
  end;
  if (select account_role from public.profiles where id = v_user) <> 'engineer' then
    raise exception 'Perfil do usuário foi alterado';
  end if;

  -- Organização vizinha não recebe ninguém.
  insert into public.organizations(name, slug) values('TEST ROLLBACK', gen_random_uuid()::text) returning id into v_other;
  insert into public.projects(organization_id, name, client_name, address, start_date, planned_end_date, created_by)
  values(v_other, 'TEST ROLLBACK', 'TEST', 'TEST', current_date, current_date, v_admin) returning id into v_new;
  if exists(select 1 from public.project_members where project_id = v_new and user_id <> v_admin) then
    raise exception 'Acesso atravessou a fronteira da organização';
  end if;
end $$;
