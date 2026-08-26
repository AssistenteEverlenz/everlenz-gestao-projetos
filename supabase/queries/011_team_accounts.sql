-- Diretório da equipe e dados necessários para a administração de acessos.
alter table public.profiles add column if not exists email text;

update public.profiles profile
set email = auth_user.email
from auth.users auth_user
where auth_user.id = profile.id
  and profile.email is distinct from auth_user.email;

create unique index if not exists profiles_email_unique_idx
  on public.profiles (lower(email))
  where email is not null;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email, ''),
    new.email
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = case
        when public.profiles.full_name = '' then excluded.full_name
        else public.profiles.full_name
      end;
  return new;
end;
$$;
