-- Phase 1 · 9/9 — Storage buckets and file access.
--
--   menu-photos (public)   menu-photos/<merchant_id>/<file>  — merchant team uploads, anyone views
--   rider-kyc   (private)  rider-kyc/<rider_id>/<file>       — rider uploads, admins only read;
--                          the BFF serves short-lived signed URLs and audits every view (CLAUDE.md)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('menu-photos', 'menu-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('rider-kyc', 'rider-kyc', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- First folder of an object path as a uuid, or null when it is not one (never errors in a policy).
create function private.first_folder_uuid(p_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;
grant execute on function private.first_folder_uuid(text) to anon, authenticated, service_role;

create policy menu_photos_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'menu-photos');
create policy menu_photos_member_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-photos' and private.is_merchant_member(private.first_folder_uuid(name)));
create policy menu_photos_member_update on storage.objects for update to authenticated
  using (bucket_id = 'menu-photos' and private.is_merchant_member(private.first_folder_uuid(name)))
  with check (bucket_id = 'menu-photos' and private.is_merchant_member(private.first_folder_uuid(name)));
create policy menu_photos_member_delete on storage.objects for delete to authenticated
  using (bucket_id = 'menu-photos' and private.is_merchant_member(private.first_folder_uuid(name)));

create policy rider_kyc_rider_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'rider-kyc' and private.first_folder_uuid(name) = private.current_rider_id());
create policy rider_kyc_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'rider-kyc' and private.is_admin());
