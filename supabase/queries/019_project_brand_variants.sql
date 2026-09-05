-- Separa a identidade da organização, do cliente e da obra e permite
-- compensar logos PNG transparentes em temas claros e escuros.
alter table public.organizations
  add column if not exists logo_background varchar(7) not null default '#FFFFFF'
    check (logo_background ~ '^#[0-9A-Fa-f]{6}$');

alter table public.projects
  add column if not exists logo_background varchar(7) not null default '#FFFFFF'
    check (logo_background ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists client_logo_path text,
  add column if not exists client_logo_background varchar(7) not null default '#FFFFFF'
    check (client_logo_background ~ '^#[0-9A-Fa-f]{6}$');

-- Um item com subitens é sempre uma linha-resumo; marcos são atividades-folha.
update public.tasks parent
set is_milestone = false,
    updated_at = now()
where parent.is_milestone
  and exists (
    select 1 from public.tasks child where child.parent_id = parent.id
  );

create or replace function public.set_organization_brand(
  p_logo_path text,
  p_logo_background text
)
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

  if p_logo_background !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'cor de fundo inválida';
  end if;

  update public.organizations
  set logo_url = coalesce(nullif(trim(p_logo_path), ''), logo_url),
      logo_background = upper(p_logo_background)
  where id = v_organization_id;
end;
$$;

create or replace function public.set_project_brand(
  p_project_id uuid,
  p_scope text,
  p_logo_path text,
  p_logo_background text
)
returns void
language plpgsql security definer set search_path=public
as $$
begin
  if not public.has_project_role(
    p_project_id,
    array['admin','manager']::public.project_role[]
  ) then
    raise exception 'sem permissão para alterar a identidade deste projeto';
  end if;

  if p_scope not in ('project','client') then
    raise exception 'tipo de identidade inválido';
  end if;

  if p_logo_background !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'cor de fundo inválida';
  end if;

  if p_scope = 'project' then
    update public.projects
    set logo_path = coalesce(nullif(trim(p_logo_path), ''), logo_path),
        logo_background = upper(p_logo_background),
        updated_at = now()
    where id = p_project_id;
  else
    update public.projects
    set client_logo_path = coalesce(nullif(trim(p_logo_path), ''), client_logo_path),
        client_logo_background = upper(p_logo_background),
        updated_at = now()
    where id = p_project_id;
  end if;
end;
$$;

revoke execute on function public.set_organization_brand(text,text) from public,anon;
revoke execute on function public.set_project_brand(uuid,text,text,text) from public,anon;
grant execute on function public.set_organization_brand(text,text) to authenticated;
grant execute on function public.set_project_brand(uuid,text,text,text) to authenticated;
