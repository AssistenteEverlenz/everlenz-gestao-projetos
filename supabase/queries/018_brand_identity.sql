-- Identidade visual configurável para a organização e para cada projeto.
alter table public.projects
  add column if not exists logo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand-assets', 'brand-assets', true, 2097152, array['image/png'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "brand managers upload assets" on storage.objects;
create policy "brand managers upload assets"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'brand-assets'
  and (storage.foldername(name))[1] = (select public.current_organization_id())::text
  and exists (
    select 1 from public.project_members pm
    join public.projects p on p.id = pm.project_id
    where pm.user_id = auth.uid()
      and pm.role in ('admin','manager')
      and p.organization_id = (select public.current_organization_id())
  )
);

drop policy if exists "brand managers delete assets" on storage.objects;
create policy "brand managers delete assets"
on storage.objects for delete to authenticated
using (
  bucket_id = 'brand-assets'
  and (storage.foldername(name))[1] = (select public.current_organization_id())::text
  and exists (
    select 1 from public.project_members pm
    join public.projects p on p.id = pm.project_id
    where pm.user_id = auth.uid()
      and pm.role in ('admin','manager')
      and p.organization_id = (select public.current_organization_id())
  )
);

create or replace function public.set_organization_logo(p_logo_path text)
returns void
language plpgsql security definer set search_path=public
as $$
declare
  v_organization_id uuid := public.current_organization_id();
begin
  if v_organization_id is null or not exists (
    select 1 from public.project_members pm
    join public.projects p on p.id = pm.project_id
    where pm.user_id = auth.uid()
      and pm.role in ('admin','manager')
      and p.organization_id = v_organization_id
  ) then
    raise exception 'sem permissão para alterar a marca da empresa';
  end if;

  update public.organizations
  set logo_url = nullif(trim(p_logo_path), '')
  where id = v_organization_id;
end;
$$;

create or replace function public.set_project_logo(p_project_id uuid, p_logo_path text)
returns void
language plpgsql security definer set search_path=public
as $$
begin
  if not public.has_project_role(
    p_project_id,
    array['admin','manager']::public.project_role[]
  ) then
    raise exception 'sem permissão para alterar a marca deste projeto';
  end if;

  update public.projects
  set logo_path = nullif(trim(p_logo_path), ''),
      updated_at = now()
  where id = p_project_id;
end;
$$;

revoke execute on function public.set_organization_logo(text) from public,anon;
revoke execute on function public.set_project_logo(uuid,text) from public,anon;
grant execute on function public.set_organization_logo(text) to authenticated;
grant execute on function public.set_project_logo(uuid,text) to authenticated;
