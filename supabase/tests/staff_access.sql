-- Run inside a transaction and ROLLBACK; requires an existing manager and admin.
do $$
declare v_user uuid; v_admin uuid; v_org uuid; v_project uuid; v_new uuid; v_other uuid;
begin
  select pm.user_id,p.organization_id,pm.project_id into v_user,v_org,v_project
  from public.project_members pm join public.projects p on p.id=pm.project_id where pm.role='manager' limit 1;
  select pm.user_id into v_admin from public.project_members pm join public.projects p on p.id=pm.project_id
  where pm.role='admin' and p.organization_id=v_org limit 1;
  if v_user is null or v_admin is null then raise exception 'Missing test fixtures'; end if;
  update public.project_members set role='engineer' where user_id=v_user;
  insert into public.projects(organization_id,name,client_name,address,start_date,planned_end_date,created_by)
  values(v_org,'TEST ROLLBACK','TEST','TEST',current_date,current_date,v_admin) returning id into v_new;
  if exists(select 1 from public.project_members where project_id=v_new and user_id=v_user) then
    raise exception 'Ordinary user automatically received access';
  end if;
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  if public.can_create_organization_project(v_org) then raise exception 'Ordinary user can create project'; end if;
  update public.project_members set role='manager' where user_id=v_user and project_id=v_project;
  if exists(select 1 from public.projects p where p.organization_id=v_org and not exists(
    select 1 from public.project_members pm where pm.project_id=p.id and pm.user_id=v_user and pm.role='manager'
  )) then raise exception 'Promotion missed an existing project'; end if;
  if not public.can_create_organization_project(v_org) then raise exception 'Manager cannot create project'; end if;
  v_new := public.create_project_with_owner('TEST ROLLBACK','TEST','TEST',current_date,current_date);
  if not exists(select 1 from public.project_members where project_id=v_new and user_id=v_user and role='manager') then
    raise exception 'Creating project changed manager role';
  end if;
  if not exists(select 1 from public.project_members where project_id=v_new and user_id=v_admin and role='admin') then
    raise exception 'Admin missing from future project';
  end if;
  insert into public.organizations(name,slug) values('TEST ROLLBACK',gen_random_uuid()::text) returning id into v_other;
  insert into public.projects(organization_id,name,client_name,address,start_date,planned_end_date,created_by)
  values(v_other,'TEST ROLLBACK','TEST','TEST',current_date,current_date,v_admin) returning id into v_new;
  if exists(select 1 from public.project_members where project_id=v_new and user_id=v_user) then
    raise exception 'Access crossed organization boundary';
  end if;
end $$;
