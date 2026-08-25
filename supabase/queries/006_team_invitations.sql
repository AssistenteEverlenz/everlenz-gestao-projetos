-- Convites persistentes e associação automática no primeiro login.
create extension if not exists citext;

create table public.project_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  email citext not null,
  role public.project_role not null default 'engineer',
  invited_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(project_id, email)
);
create index project_invitations_email_idx on public.project_invitations(email, accepted_at);
alter table public.project_invitations enable row level security;

create policy "managers read invitations" on public.project_invitations for select to authenticated
using (public.has_project_role(project_id, array['admin','manager']::public.project_role[]) or email = (auth.jwt() ->> 'email')::public.citext);

create or replace function public.invite_project_member(p_project_id uuid, p_email text, p_role public.project_role)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_invitation_id uuid;
begin
  if not public.has_project_role(p_project_id, array['admin','manager']::public.project_role[]) then
    raise exception 'only project managers can invite members';
  end if;
  if p_role = 'admin' and not public.has_project_role(p_project_id, array['admin']::public.project_role[]) then
    raise exception 'only administrators can invite another administrator';
  end if;
  insert into public.project_invitations(project_id, email, role, invited_by)
  values(p_project_id, lower(trim(p_email))::public.citext, p_role, auth.uid())
  on conflict(project_id, email) do update set
    role = excluded.role, invited_by = auth.uid(), expires_at = now() + interval '7 days', accepted_at = null
  returning id into v_invitation_id;
  return v_invitation_id;
end;
$$;

create or replace function public.claim_project_invitations()
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_email public.citext; v_org_id uuid; v_count integer := 0;
begin
  select lower(u.email)::public.citext into v_email from auth.users u where u.id = auth.uid();
  select p.organization_id into v_org_id
  from public.project_invitations i
  join public.projects p on p.id = i.project_id
  where i.email = v_email and i.accepted_at is null and i.expires_at > now()
  order by i.created_at limit 1;
  if v_org_id is null then return 0; end if;

  update public.profiles set organization_id = v_org_id
  where id = auth.uid() and (organization_id is null or organization_id = v_org_id);
  if not found then raise exception 'invitation belongs to another organization'; end if;

  insert into public.project_members(project_id, user_id, role, accepted_at)
  select i.project_id, auth.uid(), i.role, now()
  from public.project_invitations i
  join public.projects p on p.id = i.project_id
  where i.email = v_email and i.accepted_at is null and i.expires_at > now() and p.organization_id = v_org_id
  on conflict(project_id, user_id) do update set role = excluded.role, accepted_at = now();
  get diagnostics v_count = row_count;

  update public.project_invitations set accepted_at = now()
  where email = v_email and accepted_at is null and expires_at > now()
    and project_id in (select p.id from public.projects p where p.organization_id = v_org_id);
  return v_count;
end;
$$;

revoke execute on function public.invite_project_member(uuid,text,public.project_role) from public, anon;
revoke execute on function public.claim_project_invitations() from public, anon;
grant execute on function public.invite_project_member(uuid,text,public.project_role) to authenticated;
grant execute on function public.claim_project_invitations() to authenticated;
