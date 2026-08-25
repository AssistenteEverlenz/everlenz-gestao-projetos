-- Buckets privados. Caminhos: organization_id/project_id/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('worksite-photos', 'worksite-photos', false, 15728640, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-files', 'project-files', false, 52428800)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

create policy "members read worksite photos" on storage.objects for select to authenticated using (
  bucket_id = 'worksite-photos' and exists (
    select 1 from public.project_members pm
    where pm.user_id = auth.uid() and pm.project_id::text = (storage.foldername(name))[2]
  )
);
create policy "field team uploads worksite photos" on storage.objects for insert to authenticated with check (
  bucket_id = 'worksite-photos' and exists (
    select 1 from public.project_members pm
    where pm.user_id = auth.uid() and pm.project_id::text = (storage.foldername(name))[2]
      and pm.role in ('admin','manager','engineer','foreman')
  )
);
create policy "uploader updates worksite photos" on storage.objects for update to authenticated using (bucket_id = 'worksite-photos' and owner_id = auth.uid()::text) with check (bucket_id = 'worksite-photos' and owner_id = auth.uid()::text);
create policy "uploader deletes worksite photos" on storage.objects for delete to authenticated using (bucket_id = 'worksite-photos' and owner_id = auth.uid()::text);

create policy "members read project files storage" on storage.objects for select to authenticated using (
  bucket_id = 'project-files' and exists (
    select 1 from public.project_members pm
    where pm.user_id = auth.uid() and pm.project_id::text = (storage.foldername(name))[2]
  )
);
create policy "staff uploads project files storage" on storage.objects for insert to authenticated with check (
  bucket_id = 'project-files' and exists (
    select 1 from public.project_members pm
    where pm.user_id = auth.uid() and pm.project_id::text = (storage.foldername(name))[2]
      and pm.role in ('admin','manager','engineer')
  )
);
create policy "uploader updates project files storage" on storage.objects for update to authenticated using (bucket_id = 'project-files' and owner_id = auth.uid()::text) with check (bucket_id = 'project-files' and owner_id = auth.uid()::text);
create policy "uploader deletes project files storage" on storage.objects for delete to authenticated using (bucket_id = 'project-files' and owner_id = auth.uid()::text);
