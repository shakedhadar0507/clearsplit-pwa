-- Signup gate trigger on auth.users, realtime publication, private storage buckets.

drop trigger if exists clearsplit_on_auth_user_created on auth.users;
create trigger clearsplit_on_auth_user_created
  after insert on auth.users
  for each row execute function public._handle_new_auth_user();

-- Keep profile email in sync if a user changes their auth email
create or replace function public._handle_auth_user_email_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    perform set_config('clearsplit.internal', 'on', true);
    update public.profiles set email = lower(new.email) where id = new.id;
    perform set_config('clearsplit.internal', 'off', true);
  end if;
  return new;
end;
$$;
drop trigger if exists clearsplit_on_auth_user_updated on auth.users;
create trigger clearsplit_on_auth_user_updated
  after update of email on auth.users
  for each row execute function public._handle_auth_user_email_change();

-- Realtime (RLS is enforced for postgres_changes subscribers)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.expenses, public.settlements, public.notifications,
      public.group_members, public.groups;
  end if;
end $$;

-- Private storage buckets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']),
  ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- receipts/<group_id>/<expense_id>/<file>
create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.is_group_member(((storage.foldername(name))[1])::uuid));
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts'
    and public.is_group_member(((storage.foldername(name))[1])::uuid)
    and exists (select 1 from public.expenses e
                 where e.id = ((storage.foldername(name))[2])::uuid
                   and e.group_id = ((storage.foldername(name))[1])::uuid));
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (owner_id = auth.uid()::text
         or public.is_group_admin(((storage.foldername(name))[1])::uuid)));

-- avatars/<user_id>/<file>; readable by any active app user who can see the profile
create policy avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.can_see_profile(((storage.foldername(name))[1])::uuid));
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_user());
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and owner_id = auth.uid()::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and owner_id = auth.uid()::text);
