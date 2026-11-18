-- ClearSplit core schema
-- Money is stored as bigint minor units. Balances are always derived from ledger rows.
-- All financial writes go through SECURITY DEFINER functions that validate authorization
-- and invariants inside a single transaction. Clients have read-only table access via RLS.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create table public.currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  decimals smallint not null check (decimals between 0 and 4),
  symbol text not null
);
insert into public.currencies (code, decimals, symbol) values
  ('ILS', 2, '₪'), ('USD', 2, '$'), ('EUR', 2, '€'), ('GBP', 2, '£'), ('JPY', 0, '¥');

-- ---------------------------------------------------------------------------
-- Application settings (singleton)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  owner_id uuid,
  allow_member_invites boolean not null default false,
  invite_ttl_hours integer not null default 168 check (invite_ttl_hours between 1 and 720),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (1);

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user). No FK to auth.users on purpose: history must
-- survive account deletion (profile is anonymised instead).
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key,
  email text,
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar_path text,
  locale text not null default 'he' check (locale in ('he', 'en')),
  default_currency text not null default 'ILS' references public.currencies(code),
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  notify_prefs jsonb not null default '{"expenses": true, "settlements": true, "groups": true}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Groups & membership
-- ---------------------------------------------------------------------------
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text check (name is null or char_length(name) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  category text not null default 'other'
    check (category in ('trip', 'apartment', 'friends', 'couple', 'restaurant', 'event', 'other', 'direct')),
  currency text not null default 'ILS' references public.currencies(code),
  is_direct boolean not null default false,
  created_by uuid not null references public.profiles(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (is_direct or name is not null),
  check ((category = 'direct') = is_direct)
);

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id) where left_at is null;

create table public.friendships (
  user_a uuid not null references public.profiles(id),
  user_b uuid not null references public.profiles(id),
  direct_group_id uuid not null references public.groups(id),
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index friendships_b_idx on public.friendships (user_b);

-- ---------------------------------------------------------------------------
-- Invitations (single use, hashed token, expiring, optionally bound to email)
-- ---------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  email text check (email is null or email = lower(email)),
  group_id uuid references public.groups(id) on delete cascade,
  created_by uuid references public.profiles(id),
  can_create_account boolean not null default false,
  is_owner_invite boolean not null default false,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references public.profiles(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invitations_created_by_idx on public.invitations (created_by, created_at desc);

-- ---------------------------------------------------------------------------
-- Expenses (soft-deleted, versioned, with revision snapshots)
-- ---------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  description text not null check (char_length(description) between 1 and 120),
  category text not null default 'other'
    check (category in ('food', 'groceries', 'transportation', 'accommodation', 'shopping',
                        'entertainment', 'utilities', 'rent', 'travel', 'other')),
  currency text not null references public.currencies(code),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor < 100000000000000),
  expense_date date not null default current_date,
  notes text check (notes is null or char_length(notes) <= 1000),
  split_method text not null check (split_method in ('equal', 'exact', 'percentage', 'shares')),
  version integer not null default 1,
  idempotency_key uuid,
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id),
  unique (created_by, idempotency_key)
);
create index expenses_group_date_idx on public.expenses (group_id, expense_date desc, created_at desc);

create table public.expense_payers (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  amount_minor bigint not null check (amount_minor > 0),
  primary key (expense_id, user_id)
);
create index expense_payers_user_idx on public.expense_payers (user_id);

create table public.expense_splits (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  amount_minor bigint not null check (amount_minor >= 0),
  input_value bigint check (input_value is null or input_value >= 0),
  primary key (expense_id, user_id)
);
create index expense_splits_user_idx on public.expense_splits (user_id);

create table public.expense_revisions (
  id bigint generated always as identity primary key,
  expense_id uuid not null references public.expenses(id) on delete cascade,
  version integer not null,
  action text not null check (action in ('created', 'updated', 'deleted', 'restored')),
  snapshot jsonb not null,
  changed_by uuid not null references public.profiles(id),
  changed_at timestamptz not null default now()
);
create index expense_revisions_expense_idx on public.expense_revisions (expense_id, id);

create table public.receipt_attachments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index receipt_attachments_expense_idx on public.receipt_attachments (expense_id);

-- ---------------------------------------------------------------------------
-- Settlements (manual payment records; pending → confirmed workflow)
-- ---------------------------------------------------------------------------
create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  currency text not null references public.currencies(code),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor < 100000000000000),
  from_user uuid not null references public.profiles(id),
  to_user uuid not null references public.profiles(id),
  settled_on date not null default current_date,
  notes text check (notes is null or char_length(notes) <= 500),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'cancelled', 'reversed')),
  idempotency_key uuid,
  created_by uuid not null references public.profiles(id),
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  reversal_reason text check (reversal_reason is null or char_length(reversal_reason) <= 300),
  created_at timestamptz not null default now(),
  check (from_user <> to_user),
  unique (created_by, idempotency_key)
);
create index settlements_group_idx on public.settlements (group_id, created_at desc);
create index settlements_to_pending_idx on public.settlements (to_user) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Activity log & notifications
-- ---------------------------------------------------------------------------
create table public.activity_logs (
  id bigint generated always as identity primary key,
  group_id uuid references public.groups(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  audience uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_logs_group_idx on public.activity_logs (group_id, id desc);
create index activity_logs_audience_idx on public.activity_logs using gin (audience);

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id),
  type text not null,
  group_id uuid references public.groups(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, id desc);

-- ---------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER to avoid RLS recursion)
-- ---------------------------------------------------------------------------
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active);
$$;

create or replace function public.is_app_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and exists (select 1 from app_settings where owner_id = auth.uid());
$$;

create or replace function public.is_group_member(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and exists (
    select 1 from group_members where group_id = gid and user_id = auth.uid() and left_at is null);
$$;

create or replace function public.is_group_admin(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and exists (
    select 1 from group_members where group_id = gid and user_id = auth.uid() and left_at is null and role = 'admin');
$$;

-- Can the caller see this person's profile? (self, owner, co-member past or present, friend)
create or replace function public.can_see_profile(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and (
    pid = auth.uid()
    or public.is_app_owner()
    or exists (
      select 1 from group_members me join group_members them on them.group_id = me.group_id
      where me.user_id = auth.uid() and me.left_at is null and them.user_id = pid)
    or exists (
      select 1 from friendships f
      where (f.user_a = auth.uid() and f.user_b = pid) or (f.user_b = auth.uid() and f.user_a = pid)));
$$;

create or replace function public._err(code text) returns void
language plpgsql volatile as $$
begin
  raise exception 'cs:%', code using errcode = 'P0001';
end;
$$;

create or replace function public._require_active() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.is_active_user() then perform public._err('not_authenticated'); end if;
  return uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Activity & notification writers (internal only)
-- ---------------------------------------------------------------------------
create or replace function public._log(gid uuid, act text, etype text, eid uuid, det jsonb, aud uuid[] default '{}')
returns void language sql security definer set search_path = public as $$
  insert into activity_logs (group_id, actor_id, action, entity_type, entity_id, details, audience)
  values (gid, auth.uid(), act, etype, eid, coalesce(det, '{}'::jsonb), coalesce(aud, '{}'));
$$;

create or replace function public._notify(uid uuid, ntype text, gid uuid, payload jsonb, pref text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if uid is null or uid = auth.uid() then return; end if;
  if exists (select 1 from profiles p where p.id = uid and p.is_active
             and coalesce((p.notify_prefs ->> pref)::boolean, true)) then
    insert into notifications (user_id, type, group_id, payload) values (uid, ntype, gid, coalesce(payload, '{}'::jsonb));
  end if;
end;
$$;

create or replace function public._notify_group(gid uuid, ntype text, payload jsonb, pref text)
returns void language plpgsql security definer set search_path = public as $$
declare m record;
begin
  for m in select user_id from group_members where group_id = gid and left_at is null loop
    perform public._notify(m.user_id, ntype, gid, payload, pref);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile guard: users may edit only cosmetic fields of their own profile
-- ---------------------------------------------------------------------------
create or replace function public._profiles_guard() returns trigger
language plpgsql as $$
begin
  if current_setting('clearsplit.internal', true) = 'on' then
    new.updated_at := now();
    return new;
  end if;
  if new.id <> old.id or new.is_active <> old.is_active or new.deleted_at is distinct from old.deleted_at
     or new.email is distinct from old.email or new.created_at <> old.created_at then
    perform public._err('forbidden_field');
  end if;
  if new.avatar_path is not null and new.avatar_path not like (new.id::text || '/%') then
    perform public._err('invalid_avatar_path');
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public._profiles_guard();

-- Group update guard (admins may edit metadata directly; structural fields locked)
create or replace function public._groups_guard() returns trigger
language plpgsql as $$
begin
  if new.is_direct <> old.is_direct or new.created_by <> old.created_by or new.category = 'direct' and not old.is_direct then
    perform public._err('forbidden_field');
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger groups_guard before update on public.groups
  for each row execute function public._groups_guard();

-- ---------------------------------------------------------------------------
-- Balances (derived)
-- ---------------------------------------------------------------------------
create or replace function public._group_nets(gid uuid)
returns table (user_id uuid, currency text, net bigint)
language sql stable security definer set search_path = public as $$
  with lines as (
    select p.user_id, e.currency, p.amount_minor as v
      from expenses e join expense_payers p on p.expense_id = e.id
     where e.group_id = gid and e.deleted_at is null
    union all
    select s.user_id, e.currency, -s.amount_minor
      from expenses e join expense_splits s on s.expense_id = e.id
     where e.group_id = gid and e.deleted_at is null
    union all
    select st.from_user, st.currency, st.amount_minor from settlements st
     where st.group_id = gid and st.status = 'confirmed'
    union all
    select st.to_user, st.currency, -st.amount_minor from settlements st
     where st.group_id = gid and st.status = 'confirmed'
  )
  select user_id, currency, sum(v)::bigint as net from lines group by user_id, currency;
$$;

create or replace function public.group_balances(gid uuid)
returns table (user_id uuid, currency text, net bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_group_member(gid) then perform public._err('not_member'); end if;
  return query select * from public._group_nets(gid);
end;
$$;

create or replace function public.my_balances()
returns table (group_id uuid, currency text, net bigint)
language sql stable security definer set search_path = public as $$
  select gm.group_id, n.currency, n.net
    from group_members gm
    cross join lateral public._group_nets(gm.group_id) n
   where gm.user_id = auth.uid() and gm.left_at is null and public.is_active_user()
     and n.user_id = auth.uid() and n.net <> 0;
$$;

create or replace function public._has_open_balance(gid uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public._group_nets(gid) n where n.user_id = uid and n.net <> 0)
      or exists (select 1 from settlements s where s.group_id = gid and s.status = 'pending'
                 and (s.from_user = uid or s.to_user = uid));
$$;

-- ---------------------------------------------------------------------------
-- Signup gate: every new auth user must present a valid invitation token.
-- Runs inside the auth.users INSERT transaction; raising aborts the signup.
-- ---------------------------------------------------------------------------
create or replace function public._handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tok text := new.raw_user_meta_data ->> 'invite_token';
  inv invitations%rowtype;
  dname text := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'User'), 60);
  loc text := case when new.raw_user_meta_data ->> 'locale' = 'en' then 'en' else 'he' end;
begin
  if tok is null or length(tok) < 32 then
    raise exception 'cs:signup_requires_invitation' using errcode = 'P0001';
  end if;
  select * into inv from invitations where token_hash = sha256(convert_to(tok, 'UTF8')) for update;
  if not found or inv.used_at is not null or inv.revoked_at is not null or inv.expires_at < now()
     or not inv.can_create_account then
    raise exception 'cs:invalid_invitation' using errcode = 'P0001';
  end if;
  if inv.email is not null and inv.email <> lower(new.email) then
    raise exception 'cs:invitation_email_mismatch' using errcode = 'P0001';
  end if;
  if inv.is_owner_invite and exists (select 1 from app_settings where owner_id is not null) then
    raise exception 'cs:owner_already_set' using errcode = 'P0001';
  end if;

  insert into profiles (id, email, display_name, locale) values (new.id, lower(new.email), dname, loc);
  update invitations set used_at = now(), used_by = new.id where id = inv.id;

  if inv.is_owner_invite then
    update app_settings set owner_id = new.id, updated_at = now() where id = 1;
  end if;
  perform public._apply_invitation(inv.id, new.id);
  return new;
end;
$$;

-- Shared logic for consuming an invitation (new or existing user)
create or replace function public._apply_invitation(inv_id uuid, uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv invitations%rowtype;
begin
  select * into inv from invitations where id = inv_id;
  if inv.created_by is not null and inv.created_by <> uid then
    perform public._ensure_friendship(inv.created_by, uid);
  end if;
  if inv.group_id is not null then
    insert into group_members (group_id, user_id, role) values (inv.group_id, uid, 'member')
      on conflict (group_id, user_id) do update set left_at = null, joined_at = now();
    insert into activity_logs (group_id, actor_id, action, entity_type, entity_id, details)
      values (inv.group_id, uid, 'member_joined', 'user', uid, jsonb_build_object('invited_by', inv.created_by));
    perform public._notify(inv.created_by, 'member_joined', inv.group_id, jsonb_build_object('user_id', uid), 'groups');
  end if;
end;
$$;

create or replace function public._ensure_friendship(u1 uuid, u2 uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare a uuid := least(u1, u2); b uuid := greatest(u1, u2); gid uuid;
begin
  select direct_group_id into gid from friendships where user_a = a and user_b = b;
  if found then return gid; end if;
  -- Reuse an earlier direct group between the same two people (preserves history)
  select g.id into gid from groups g
   where g.is_direct and exists (select 1 from group_members where group_id = g.id and user_id = a)
                     and exists (select 1 from group_members where group_id = g.id and user_id = b)
   limit 1;
  if gid is null then
    insert into groups (name, category, is_direct, created_by, currency)
      values (null, 'direct', true, u1, coalesce((select default_currency from profiles where id = u1), 'ILS'))
      returning id into gid;
    insert into group_members (group_id, user_id, role) values (gid, a, 'admin'), (gid, b, 'admin');
  else
    update group_members set left_at = null where group_id = gid;
  end if;
  insert into friendships (user_a, user_b, direct_group_id) values (a, b, gid);
  insert into activity_logs (group_id, actor_id, action, entity_type, entity_id, details, audience)
    values (null, auth.uid(), 'friend_added', 'user', null, jsonb_build_object('user_a', a, 'user_b', b), array[a, b]);
  return gid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner bootstrap (callable ONLY by the database owner / service role, e.g. via
-- the Supabase SQL editor). Returns a one-time token; email is never in source.
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_owner_invitation(owner_email text, ttl_hours integer default 48)
returns text language plpgsql security definer set search_path = public as $$
declare tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if exists (select 1 from app_settings where owner_id is not null) then
    perform public._err('owner_already_set');
  end if;
  update invitations set revoked_at = now() where is_owner_invite and used_at is null and revoked_at is null;
  insert into invitations (token_hash, email, can_create_account, is_owner_invite, expires_at)
    values (sha256(convert_to(tok, 'UTF8')), lower(trim(owner_email)), true, true, now() + make_interval(hours => ttl_hours));
  return tok;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitations API
-- ---------------------------------------------------------------------------
create or replace function public.create_invitation(p_email text default null, p_group_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  s app_settings%rowtype;
  em text := nullif(lower(trim(p_email)), '');
  inv_id uuid;
  exp timestamptz;
begin
  select * into s from app_settings where id = 1;
  if p_group_id is not null then
    if not public.is_group_member(p_group_id) then perform public._err('not_member'); end if;
    if exists (select 1 from groups where id = p_group_id and (is_direct or archived_at is not null)) then
      perform public._err('group_not_invitable');
    end if;
  end if;
  if em is not null and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform public._err('invalid_email'); end if;
  if (select count(*) from invitations where created_by = uid and created_at > now() - interval '1 hour') >= 30 then
    perform public._err('rate_limited');
  end if;
  exp := now() + make_interval(hours => s.invite_ttl_hours);
  insert into invitations (token_hash, email, group_id, created_by, can_create_account, expires_at)
    values (sha256(convert_to(tok, 'UTF8')), em, p_group_id, uid, (s.owner_id = uid) or s.allow_member_invites, exp)
    returning id into inv_id;
  perform public._log(p_group_id, 'member_invited', 'invitation', inv_id,
                      jsonb_build_object('email', em), array[uid]);
  return jsonb_build_object('id', inv_id, 'token', tok, 'expires_at', exp,
                            'can_create_account', (s.owner_id = uid) or s.allow_member_invites);
end;
$$;

-- Public (anon-callable) minimal lookup used by the join page.
create or replace function public.get_invitation_info(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare inv invitations%rowtype; inviter text; gname text;
begin
  if p_token is null or length(p_token) < 32 then return jsonb_build_object('valid', false); end if;
  select * into inv from invitations where token_hash = sha256(convert_to(p_token, 'UTF8'));
  if not found or inv.used_at is not null or inv.revoked_at is not null or inv.expires_at < now() then
    return jsonb_build_object('valid', false);
  end if;
  select display_name into inviter from profiles where id = inv.created_by;
  select name into gname from groups where id = inv.group_id;
  return jsonb_build_object('valid', true, 'inviter', inviter, 'group_name', gname,
    'email_bound', inv.email is not null, 'email', inv.email,
    'can_create_account', inv.can_create_account, 'is_owner_invite', inv.is_owner_invite,
    'expires_at', inv.expires_at);
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := public._require_active(); inv invitations%rowtype; my_email text;
begin
  select * into inv from invitations where token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8')) for update;
  if not found or inv.used_at is not null or inv.revoked_at is not null or inv.expires_at < now() or inv.is_owner_invite then
    perform public._err('invalid_invitation');
  end if;
  select email into my_email from profiles where id = uid;
  if inv.email is not null and inv.email <> my_email then perform public._err('invitation_email_mismatch'); end if;
  if inv.created_by = uid then perform public._err('own_invitation'); end if;
  update invitations set used_at = now(), used_by = uid where id = inv.id;
  perform public._apply_invitation(inv.id, uid);
  return jsonb_build_object('group_id', inv.group_id, 'inviter', inv.created_by);
end;
$$;

create or replace function public.revoke_invitation(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active();
begin
  update invitations set revoked_at = now()
   where id = p_id and used_at is null and revoked_at is null
     and (created_by = uid or public.is_app_owner());
  if not found then perform public._err('not_found'); end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Groups API
-- ---------------------------------------------------------------------------
create or replace function public.create_group(p_name text, p_description text, p_category text, p_currency text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active(); gid uuid;
begin
  if p_category = 'direct' then perform public._err('invalid_category'); end if;
  insert into groups (name, description, category, currency, created_by)
    values (trim(p_name), nullif(trim(p_description), ''), coalesce(p_category, 'other'), coalesce(p_currency, 'ILS'), uid)
    returning id into gid;
  insert into group_members (group_id, user_id, role) values (gid, uid, 'admin');
  perform public._log(gid, 'group_created', 'group', gid, jsonb_build_object('name', trim(p_name)));
  return gid;
end;
$$;

create or replace function public.update_group(p_group_id uuid, p_name text, p_description text, p_category text, p_currency text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_active();
  if not public.is_group_admin(p_group_id) then perform public._err('not_admin'); end if;
  if p_category = 'direct' then perform public._err('invalid_category'); end if;
  update groups set name = trim(p_name), description = nullif(trim(p_description), ''),
                    category = p_category, currency = p_currency
   where id = p_group_id and not is_direct;
  if not found then perform public._err('not_found'); end if;
  perform public._log(p_group_id, 'group_updated', 'group', p_group_id, jsonb_build_object('name', trim(p_name)));
end;
$$;

create or replace function public.set_group_archived(p_group_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_active();
  if not public.is_group_admin(p_group_id) then perform public._err('not_admin'); end if;
  update groups set archived_at = case when p_archived then now() else null end
   where id = p_group_id and not is_direct;
  if not found then perform public._err('not_found'); end if;
  perform public._log(p_group_id, case when p_archived then 'group_archived' else 'group_unarchived' end, 'group', p_group_id, '{}');
end;
$$;

create or replace function public.remove_group_member(p_group_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active();
begin
  if exists (select 1 from groups where id = p_group_id and is_direct) then perform public._err('direct_group'); end if;
  if p_user_id = uid then
    if not public.is_group_member(p_group_id) then perform public._err('not_member'); end if;
  elsif not public.is_group_admin(p_group_id) then
    perform public._err('not_admin');
  end if;
  if not exists (select 1 from group_members where group_id = p_group_id and user_id = p_user_id and left_at is null) then
    perform public._err('not_found');
  end if;
  if public._has_open_balance(p_group_id, p_user_id) then perform public._err('open_balance'); end if;
  if (select role from group_members where group_id = p_group_id and user_id = p_user_id) = 'admin'
     and (select count(*) from group_members where group_id = p_group_id and role = 'admin' and left_at is null) = 1
     and (select count(*) from group_members where group_id = p_group_id and left_at is null) > 1 then
    perform public._err('last_admin');
  end if;
  update group_members set left_at = now() where group_id = p_group_id and user_id = p_user_id;
  perform public._log(p_group_id, case when p_user_id = uid then 'member_left' else 'member_removed' end, 'user', p_user_id, '{}');
  perform public._notify(p_user_id, 'removed_from_group', p_group_id,
                         jsonb_build_object('group_name', (select name from groups where id = p_group_id)), 'groups');
end;
$$;

create or replace function public.set_member_role(p_group_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_active();
  if not public.is_group_admin(p_group_id) then perform public._err('not_admin'); end if;
  if p_role not in ('admin', 'member') then perform public._err('invalid_role'); end if;
  if p_role = 'member' and (select count(*) from group_members where group_id = p_group_id and role = 'admin' and left_at is null) = 1
     and exists (select 1 from group_members where group_id = p_group_id and user_id = p_user_id and role = 'admin') then
    perform public._err('last_admin');
  end if;
  update group_members set role = p_role where group_id = p_group_id and user_id = p_user_id and left_at is null;
  if not found then perform public._err('not_found'); end if;
  perform public._log(p_group_id, 'member_role_changed', 'user', p_user_id, jsonb_build_object('role', p_role));
end;
$$;

-- Add an existing co-member of a group as a friend (no searching of all users).
create or replace function public.add_friend_from_group(p_user_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active();
begin
  if p_user_id = uid then perform public._err('invalid_user'); end if;
  if not exists (
    select 1 from group_members me join group_members them on them.group_id = me.group_id
     where me.user_id = uid and me.left_at is null and them.user_id = p_user_id and them.left_at is null)
     or not exists (select 1 from profiles where id = p_user_id and is_active) then
    perform public._err('not_found');
  end if;
  return public._ensure_friendship(uid, p_user_id);
end;
$$;

create or replace function public.remove_friend(p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active(); a uuid := least(uid, p_user_id); b uuid := greatest(uid, p_user_id); gid uuid;
begin
  select direct_group_id into gid from friendships where user_a = a and user_b = b;
  if gid is null then perform public._err('not_found'); end if;
  if public._has_open_balance(gid, uid) then perform public._err('open_balance'); end if;
  delete from friendships where user_a = a and user_b = b;
  insert into activity_logs (actor_id, action, entity_type, details, audience)
    values (uid, 'friend_removed', 'user', jsonb_build_object('user_a', a, 'user_b', b), array[a, b]);
end;
$$;

-- ---------------------------------------------------------------------------
-- Expenses API
-- Payload: { group_id, description, category, currency, amount_minor, expense_date, notes,
--            split_method, payers: [{user_id, amount_minor}], splits: [{user_id, amount_minor, input_value}],
--            idempotency_key }
-- ---------------------------------------------------------------------------
create or replace function public._validate_expense(gid uuid, p jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  total bigint;
  method text := p ->> 'split_method';
  pay_sum numeric; split_sum numeric; input_sum numeric;
  n_pay int; n_split int; n_pay_distinct int; n_split_distinct int; bad int;
begin
  if not public.is_group_member(gid) then perform public._err('not_member'); end if;
  if exists (select 1 from groups where id = gid and archived_at is not null) then perform public._err('group_archived'); end if;
  begin
    total := (p ->> 'amount_minor')::bigint;
  exception when others then perform public._err('invalid_amount');
  end;
  if total is null or total <= 0 then perform public._err('invalid_amount'); end if;
  if not exists (select 1 from currencies where code = p ->> 'currency') then perform public._err('invalid_currency'); end if;
  if method is null or method not in ('equal', 'exact', 'percentage', 'shares') then perform public._err('invalid_split_method'); end if;
  if jsonb_typeof(p -> 'payers') <> 'array' or jsonb_typeof(p -> 'splits') <> 'array' then perform public._err('invalid_payload'); end if;

  select count(*), count(distinct x ->> 'user_id'), coalesce(sum((x ->> 'amount_minor')::numeric), 0),
         count(*) filter (where (x ->> 'amount_minor')::numeric <= 0 or (x ->> 'amount_minor')::numeric <> trunc((x ->> 'amount_minor')::numeric))
    into n_pay, n_pay_distinct, pay_sum, bad
    from jsonb_array_elements(p -> 'payers') x;
  if n_pay = 0 or n_pay <> n_pay_distinct or bad > 0 then perform public._err('invalid_payers'); end if;
  if pay_sum <> total then perform public._err('payers_mismatch'); end if;

  select count(*), count(distinct x ->> 'user_id'), coalesce(sum((x ->> 'amount_minor')::numeric), 0),
         coalesce(sum((x ->> 'input_value')::numeric), 0),
         count(*) filter (where (x ->> 'amount_minor')::numeric < 0 or (x ->> 'amount_minor')::numeric <> trunc((x ->> 'amount_minor')::numeric))
    into n_split, n_split_distinct, split_sum, input_sum, bad
    from jsonb_array_elements(p -> 'splits') x;
  if n_split = 0 or n_split <> n_split_distinct or bad > 0 then perform public._err('invalid_splits'); end if;
  if split_sum <> total then perform public._err('splits_mismatch'); end if;
  if not exists (select 1 from jsonb_array_elements(p -> 'splits') x where (x ->> 'amount_minor')::bigint > 0) then
    perform public._err('invalid_splits');
  end if;
  if method = 'percentage' and input_sum <> 10000 then perform public._err('percent_mismatch'); end if;
  if method = 'equal' and (select max((x ->> 'amount_minor')::bigint) - min((x ->> 'amount_minor')::bigint)
                             from jsonb_array_elements(p -> 'splits') x) > 1 then
    perform public._err('splits_not_equal');
  end if;

  -- every payer and participant must be an active member of this group
  if exists (
    select 1 from (
      select (x ->> 'user_id')::uuid as u from jsonb_array_elements(p -> 'payers') x
      union select (x ->> 'user_id')::uuid from jsonb_array_elements(p -> 'splits') x) t
    where not exists (select 1 from group_members gm where gm.group_id = gid and gm.user_id = t.u and gm.left_at is null)) then
    perform public._err('participant_not_member');
  end if;
  if char_length(coalesce(trim(p ->> 'description'), '')) = 0 then perform public._err('invalid_description'); end if;
end;
$$;

create or replace function public._expense_snapshot(eid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'description', e.description, 'category', e.category, 'currency', e.currency,
    'amount_minor', e.amount_minor, 'expense_date', e.expense_date, 'notes', e.notes,
    'split_method', e.split_method, 'deleted', e.deleted_at is not null,
    'payers', coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'amount_minor', amount_minor) order by user_id)
                          from expense_payers where expense_id = e.id), '[]'),
    'splits', coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'amount_minor', amount_minor, 'input_value', input_value) order by user_id)
                          from expense_splits where expense_id = e.id), '[]'))
  from expenses e where e.id = eid;
$$;

create or replace function public._write_expense_lines(eid uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from expense_payers where expense_id = eid;
  delete from expense_splits where expense_id = eid;
  insert into expense_payers (expense_id, user_id, amount_minor)
    select eid, (x ->> 'user_id')::uuid, (x ->> 'amount_minor')::bigint from jsonb_array_elements(p -> 'payers') x;
  insert into expense_splits (expense_id, user_id, amount_minor, input_value)
    select eid, (x ->> 'user_id')::uuid, (x ->> 'amount_minor')::bigint, (x ->> 'input_value')::bigint
      from jsonb_array_elements(p -> 'splits') x;
end;
$$;

create or replace function public.create_expense(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  gid uuid := (p ->> 'group_id')::uuid;
  ikey uuid := nullif(p ->> 'idempotency_key', '')::uuid;
  eid uuid;
begin
  if ikey is not null then
    select id into eid from expenses where created_by = uid and idempotency_key = ikey;
    if found then return eid; end if;
  end if;
  perform public._validate_expense(gid, p);
  insert into expenses (group_id, description, category, currency, amount_minor, expense_date, notes,
                        split_method, idempotency_key, created_by)
    values (gid, trim(p ->> 'description'), coalesce(p ->> 'category', 'other'), p ->> 'currency',
            (p ->> 'amount_minor')::bigint, coalesce((p ->> 'expense_date')::date, current_date),
            nullif(trim(p ->> 'notes'), ''), p ->> 'split_method', ikey, uid)
    returning id into eid;
  perform public._write_expense_lines(eid, p);
  insert into expense_revisions (expense_id, version, action, snapshot, changed_by)
    values (eid, 1, 'created', public._expense_snapshot(eid), uid);
  perform public._log(gid, 'expense_created', 'expense', eid,
    jsonb_build_object('description', trim(p ->> 'description'), 'amount_minor', (p ->> 'amount_minor')::bigint, 'currency', p ->> 'currency'));
  perform public._notify_group(gid, 'expense_added',
    jsonb_build_object('expense_id', eid, 'description', trim(p ->> 'description'),
                       'amount_minor', (p ->> 'amount_minor')::bigint, 'currency', p ->> 'currency'), 'expenses');
  return eid;
end;
$$;

create or replace function public._can_modify_expense(e expenses) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_group_member(e.group_id)
     and (e.created_by = auth.uid() or public.is_group_admin(e.group_id)
          or exists (select 1 from expense_payers where expense_id = e.id and user_id = auth.uid()));
$$;

create or replace function public.update_expense(p_expense_id uuid, p jsonb, p_expected_version integer)
returns integer language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active(); e expenses%rowtype;
begin
  select * into e from expenses where id = p_expense_id for update;
  if not found or not public.is_group_member(e.group_id) then perform public._err('not_found'); end if;
  if not public._can_modify_expense(e) then perform public._err('forbidden'); end if;
  if e.deleted_at is not null then perform public._err('expense_deleted'); end if;
  if e.version <> p_expected_version then perform public._err('version_conflict'); end if;
  perform public._validate_expense(e.group_id, p);
  update expenses set description = trim(p ->> 'description'), category = coalesce(p ->> 'category', 'other'),
         currency = p ->> 'currency', amount_minor = (p ->> 'amount_minor')::bigint,
         expense_date = coalesce((p ->> 'expense_date')::date, e.expense_date), notes = nullif(trim(p ->> 'notes'), ''),
         split_method = p ->> 'split_method', version = e.version + 1, updated_by = uid, updated_at = now()
   where id = e.id;
  perform public._write_expense_lines(e.id, p);
  insert into expense_revisions (expense_id, version, action, snapshot, changed_by)
    values (e.id, e.version + 1, 'updated', public._expense_snapshot(e.id), uid);
  perform public._log(e.group_id, 'expense_updated', 'expense', e.id,
    jsonb_build_object('description', trim(p ->> 'description'), 'amount_minor', (p ->> 'amount_minor')::bigint,
                       'currency', p ->> 'currency', 'previous_amount_minor', e.amount_minor, 'previous_currency', e.currency));
  perform public._notify_group(e.group_id, 'expense_updated',
    jsonb_build_object('expense_id', e.id, 'description', trim(p ->> 'description')), 'expenses');
  return e.version + 1;
end;
$$;

create or replace function public.delete_expense(p_expense_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active(); e expenses%rowtype;
begin
  select * into e from expenses where id = p_expense_id for update;
  if not found or not public.is_group_member(e.group_id) then perform public._err('not_found'); end if;
  if not public._can_modify_expense(e) then perform public._err('forbidden'); end if;
  if e.deleted_at is not null then return; end if;
  update expenses set deleted_at = now(), deleted_by = uid, version = e.version + 1 where id = e.id;
  insert into expense_revisions (expense_id, version, action, snapshot, changed_by)
    values (e.id, e.version + 1, 'deleted', public._expense_snapshot(e.id), uid);
  perform public._log(e.group_id, 'expense_deleted', 'expense', e.id,
    jsonb_build_object('description', e.description, 'amount_minor', e.amount_minor, 'currency', e.currency));
  perform public._notify_group(e.group_id, 'expense_deleted',
    jsonb_build_object('expense_id', e.id, 'description', e.description), 'expenses');
end;
$$;

create or replace function public.restore_expense(p_expense_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active(); e expenses%rowtype;
begin
  select * into e from expenses where id = p_expense_id for update;
  if not found or not public.is_group_member(e.group_id) then perform public._err('not_found'); end if;
  if not public._can_modify_expense(e) then perform public._err('forbidden'); end if;
  if e.deleted_at is null then return; end if;
  if exists (select 1 from groups where id = e.group_id and archived_at is not null) then perform public._err('group_archived'); end if;
  -- participants must still be members, otherwise balances of departed members would change
  if exists (select 1 from (select user_id from expense_payers where expense_id = e.id
                            union select user_id from expense_splits where expense_id = e.id) t
              where not exists (select 1 from group_members gm where gm.group_id = e.group_id and gm.user_id = t.user_id and gm.left_at is null)) then
    perform public._err('participant_not_member');
  end if;
  update expenses set deleted_at = null, deleted_by = null, version = e.version + 1 where id = e.id;
  insert into expense_revisions (expense_id, version, action, snapshot, changed_by)
    values (e.id, e.version + 1, 'restored', public._expense_snapshot(e.id), uid);
  perform public._log(e.group_id, 'expense_restored', 'expense', e.id,
    jsonb_build_object('description', e.description, 'amount_minor', e.amount_minor, 'currency', e.currency));
end;
$$;

create or replace function public.add_receipt(p_expense_id uuid, p_path text, p_mime text, p_size integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active(); e expenses%rowtype; rid uuid;
begin
  select * into e from expenses where id = p_expense_id;
  if not found or not public.is_group_member(e.group_id) then perform public._err('not_found'); end if;
  if p_path not like (e.group_id::text || '/' || e.id::text || '/%') then perform public._err('invalid_path'); end if;
  if (select count(*) from receipt_attachments where expense_id = e.id) >= 5 then perform public._err('too_many_receipts'); end if;
  insert into receipt_attachments (expense_id, storage_path, mime_type, size_bytes, uploaded_by)
    values (e.id, p_path, p_mime, p_size, uid) returning id into rid;
  perform public._log(e.group_id, 'receipt_added', 'expense', e.id, jsonb_build_object('description', e.description));
  return rid;
end;
$$;

create or replace function public.remove_receipt(p_receipt_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active(); r receipt_attachments%rowtype; gid uuid;
begin
  select * into r from receipt_attachments where id = p_receipt_id;
  if not found then perform public._err('not_found'); end if;
  select group_id into gid from expenses where id = r.expense_id;
  if not public.is_group_member(gid) or (r.uploaded_by <> uid and not public.is_group_admin(gid)) then
    perform public._err('forbidden');
  end if;
  delete from receipt_attachments where id = r.id;
  return r.storage_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- Settlements API
-- A settlement recorded by its recipient is confirmed immediately (the recipient
-- is giving up a claim). Otherwise it stays pending until the recipient confirms.
-- ---------------------------------------------------------------------------
create or replace function public.record_settlement(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public._require_active();
  gid uuid := (p ->> 'group_id')::uuid;
  f uuid := (p ->> 'from_user')::uuid;
  t uuid := (p ->> 'to_user')::uuid;
  amt bigint;
  ikey uuid := nullif(p ->> 'idempotency_key', '')::uuid;
  sid uuid;
  st text;
begin
  if ikey is not null then
    select id into sid from settlements where created_by = uid and idempotency_key = ikey;
    if found then return sid; end if;
  end if;
  if not public.is_group_member(gid) then perform public._err('not_member'); end if;
  if exists (select 1 from groups where id = gid and archived_at is not null) then perform public._err('group_archived'); end if;
  begin amt := (p ->> 'amount_minor')::bigint; exception when others then perform public._err('invalid_amount'); end;
  if amt is null or amt <= 0 then perform public._err('invalid_amount'); end if;
  if f is null or t is null or f = t then perform public._err('invalid_parties'); end if;
  if not exists (select 1 from currencies where code = p ->> 'currency') then perform public._err('invalid_currency'); end if;
  if (select count(*) from group_members where group_id = gid and user_id in (f, t) and left_at is null) <> 2 then
    perform public._err('participant_not_member');
  end if;
  st := case when uid = t then 'confirmed' else 'pending' end;
  insert into settlements (group_id, currency, amount_minor, from_user, to_user, settled_on, notes, status,
                           idempotency_key, created_by, confirmed_by, confirmed_at)
    values (gid, p ->> 'currency', amt, f, t, coalesce((p ->> 'settled_on')::date, current_date),
            nullif(trim(p ->> 'notes'), ''), st, ikey, uid,
            case when st = 'confirmed' then uid end, case when st = 'confirmed' then now() end)
    returning id into sid;
  perform public._log(gid, 'settlement_recorded', 'settlement', sid,
    jsonb_build_object('from_user', f, 'to_user', t, 'amount_minor', amt, 'currency', p ->> 'currency', 'status', st));
  if st = 'pending' then
    perform public._notify(t, 'settlement_requested', gid,
      jsonb_build_object('settlement_id', sid, 'from_user', f, 'amount_minor', amt, 'currency', p ->> 'currency'), 'settlements');
    if f <> uid then
      perform public._notify(f, 'settlement_recorded', gid,
        jsonb_build_object('settlement_id', sid, 'to_user', t, 'amount_minor', amt, 'currency', p ->> 'currency'), 'settlements');
    end if;
  else
    perform public._notify(f, 'settlement_confirmed', gid,
      jsonb_build_object('settlement_id', sid, 'to_user', t, 'amount_minor', amt, 'currency', p ->> 'currency'), 'settlements');
  end if;
  return sid;
end;
$$;

create or replace function public._settlement_transition(p_id uuid, p_action text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active(); s settlements%rowtype; new_status text;
begin
  select * into s from settlements where id = p_id for update;
  if not found or not public.is_group_member(s.group_id) then perform public._err('not_found'); end if;
  if p_action = 'confirm' then
    if s.status <> 'pending' then perform public._err('invalid_state'); end if;
    if uid <> s.to_user then perform public._err('forbidden'); end if;
    update settlements set status = 'confirmed', confirmed_by = uid, confirmed_at = now() where id = s.id;
    new_status := 'confirmed';
  elsif p_action = 'reject' then
    if s.status <> 'pending' then perform public._err('invalid_state'); end if;
    if uid <> s.to_user then perform public._err('forbidden'); end if;
    new_status := 'rejected';
  elsif p_action = 'cancel' then
    if s.status <> 'pending' then perform public._err('invalid_state'); end if;
    if uid <> s.created_by and uid <> s.from_user then perform public._err('forbidden'); end if;
    new_status := 'cancelled';
  elsif p_action = 'reverse' then
    if s.status <> 'confirmed' then perform public._err('invalid_state'); end if;
    if uid <> s.to_user and uid <> s.from_user then perform public._err('forbidden'); end if;
    new_status := 'reversed';
  else
    perform public._err('invalid_action');
  end if;
  if new_status <> 'confirmed' then
    update settlements set status = new_status, closed_by = uid, closed_at = now(),
           reversal_reason = case when p_action = 'reverse' then nullif(trim(p_reason), '') else reversal_reason end
     where id = s.id;
  end if;
  perform public._log(s.group_id, 'settlement_' || new_status, 'settlement', s.id,
    jsonb_build_object('from_user', s.from_user, 'to_user', s.to_user, 'amount_minor', s.amount_minor,
                       'currency', s.currency, 'reason', nullif(trim(p_reason), '')));
  perform public._notify(case when uid = s.from_user then s.to_user else s.from_user end,
    'settlement_' || new_status, s.group_id,
    jsonb_build_object('settlement_id', s.id, 'amount_minor', s.amount_minor, 'currency', s.currency), 'settlements');
  if s.created_by <> s.from_user and s.created_by <> s.to_user then
    perform public._notify(s.created_by, 'settlement_' || new_status, s.group_id,
      jsonb_build_object('settlement_id', s.id, 'amount_minor', s.amount_minor, 'currency', s.currency), 'settlements');
  end if;
end;
$$;

create or replace function public.confirm_settlement(p_id uuid) returns void
language sql security definer set search_path = public as $$ select public._settlement_transition(p_id, 'confirm'); $$;
create or replace function public.reject_settlement(p_id uuid) returns void
language sql security definer set search_path = public as $$ select public._settlement_transition(p_id, 'reject'); $$;
create or replace function public.cancel_settlement(p_id uuid) returns void
language sql security definer set search_path = public as $$ select public._settlement_transition(p_id, 'cancel'); $$;
create or replace function public.reverse_settlement(p_id uuid, p_reason text default null) returns void
language sql security definer set search_path = public as $$ select public._settlement_transition(p_id, 'reverse', p_reason); $$;

-- ---------------------------------------------------------------------------
-- Notifications API
-- ---------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids bigint[] default null) returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
$$;

-- ---------------------------------------------------------------------------
-- Owner administration
-- ---------------------------------------------------------------------------
create or replace function public.update_app_settings(p_allow_member_invites boolean, p_invite_ttl_hours integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_owner() then perform public._err('not_owner'); end if;
  update app_settings set allow_member_invites = p_allow_member_invites, invite_ttl_hours = p_invite_ttl_hours, updated_at = now()
   where id = 1;
end;
$$;

create or replace function public.set_user_active(p_user_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_owner() then perform public._err('not_owner'); end if;
  if p_user_id = auth.uid() then perform public._err('cannot_disable_self'); end if;
  perform set_config('clearsplit.internal', 'on', true);
  update profiles set is_active = p_active where id = p_user_id and deleted_at is null;
  if not found then perform public._err('not_found'); end if;
  perform set_config('clearsplit.internal', 'off', true);
  -- Invalidate outstanding invitations created by a disabled user
  if not p_active then
    update invitations set revoked_at = now() where created_by = p_user_id and used_at is null and revoked_at is null;
  end if;
  insert into activity_logs (actor_id, action, entity_type, entity_id, details, audience)
    values (auth.uid(), case when p_active then 'user_enabled' else 'user_disabled' end, 'user', p_user_id, '{}', array[auth.uid()]);
end;
$$;

create or replace function public.admin_list_users()
returns table (id uuid, email text, display_name text, is_active boolean, deleted_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_owner() then perform public._err('not_owner'); end if;
  return query select p.id, p.email, p.display_name, p.is_active, p.deleted_at, p.created_at from profiles p order by p.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Personal data export & account deletion
-- ---------------------------------------------------------------------------
create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public._require_active();
begin
  return jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) - 'notify_prefs' from profiles p where id = uid),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'category', g.category, 'role', gm.role, 'joined_at', gm.joined_at, 'left_at', gm.left_at))
                 from group_members gm join groups g on g.id = gm.group_id where gm.user_id = uid), '[]'),
    'expenses_paid', coalesce((select jsonb_agg(jsonb_build_object('expense_id', e.id, 'description', e.description, 'currency', e.currency, 'amount_paid_minor', p.amount_minor, 'date', e.expense_date, 'deleted', e.deleted_at is not null))
                 from expense_payers p join expenses e on e.id = p.expense_id where p.user_id = uid), '[]'),
    'expense_shares', coalesce((select jsonb_agg(jsonb_build_object('expense_id', e.id, 'description', e.description, 'currency', e.currency, 'share_minor', s.amount_minor, 'date', e.expense_date, 'deleted', e.deleted_at is not null))
                 from expense_splits s join expenses e on e.id = s.expense_id where s.user_id = uid), '[]'),
    'settlements', coalesce((select jsonb_agg(to_jsonb(s) - 'idempotency_key') from settlements s where s.from_user = uid or s.to_user = uid), '[]'));
end;
$$;

-- Deletes the login and anonymises the profile. Requires all balances to be zero
-- so that shared history stays consistent for everyone else.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._require_active(); g record;
begin
  if public.is_app_owner() then perform public._err('owner_cannot_delete'); end if;
  for g in select group_id from group_members where user_id = uid and left_at is null loop
    if public._has_open_balance(g.group_id, uid) then perform public._err('open_balance'); end if;
  end loop;
  update group_members set left_at = now() where user_id = uid and left_at is null;
  delete from friendships where user_a = uid or user_b = uid;
  update invitations set revoked_at = now() where created_by = uid and used_at is null and revoked_at is null;
  delete from notifications where user_id = uid;
  perform set_config('clearsplit.internal', 'on', true);
  update profiles set display_name = 'Deleted user', email = null, avatar_path = null, is_active = false, deleted_at = now()
   where id = uid;
  perform set_config('clearsplit.internal', 'off', true);
  delete from auth.users where id = uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.currencies enable row level security;
alter table public.app_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.friendships enable row level security;
alter table public.invitations enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_payers enable row level security;
alter table public.expense_splits enable row level security;
alter table public.expense_revisions enable row level security;
alter table public.receipt_attachments enable row level security;
alter table public.settlements enable row level security;
alter table public.activity_logs enable row level security;
alter table public.notifications enable row level security;

create policy currencies_read on public.currencies for select to authenticated using (true);
create policy app_settings_read on public.app_settings for select to authenticated using (public.is_active_user());

create policy profiles_read on public.profiles for select to authenticated using (public.can_see_profile(id));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_active_user()) with check (id = auth.uid());

create policy groups_read on public.groups for select to authenticated using (public.is_group_member(id));
create policy group_members_read on public.group_members for select to authenticated using (public.is_group_member(group_id));
create policy friendships_read on public.friendships for select to authenticated
  using (public.is_active_user() and (user_a = auth.uid() or user_b = auth.uid()));
create policy invitations_read on public.invitations for select to authenticated
  using (public.is_active_user() and (created_by = auth.uid() or public.is_app_owner()));

create policy expenses_read on public.expenses for select to authenticated using (public.is_group_member(group_id));
create policy expense_payers_read on public.expense_payers for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_group_member(e.group_id)));
create policy expense_splits_read on public.expense_splits for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_group_member(e.group_id)));
create policy expense_revisions_read on public.expense_revisions for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_group_member(e.group_id)));
create policy receipts_read on public.receipt_attachments for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_group_member(e.group_id)));
create policy settlements_read on public.settlements for select to authenticated using (public.is_group_member(group_id));
create policy activity_read on public.activity_logs for select to authenticated
  using (public.is_active_user() and (
    (group_id is not null and public.is_group_member(group_id)) or auth.uid() = any(audience)));
create policy notifications_read on public.notifications for select to authenticated
  using (user_id = auth.uid() and public.is_active_user());
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid() and public.is_active_user());

-- ---------------------------------------------------------------------------
-- Privileges: clients read through RLS; every write goes through functions.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant update (display_name, avatar_path, locale, default_currency, theme, notify_prefs) on public.profiles to authenticated;
grant delete on public.notifications to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.is_active_user(), public.is_app_owner(), public.is_group_member(uuid), public.is_group_admin(uuid),
  public.can_see_profile(uuid),
  public.group_balances(uuid), public.my_balances(),
  public.create_invitation(text, uuid), public.accept_invitation(text), public.revoke_invitation(uuid),
  public.create_group(text, text, text, text), public.update_group(uuid, text, text, text, text),
  public.set_group_archived(uuid, boolean), public.remove_group_member(uuid, uuid), public.set_member_role(uuid, uuid, text),
  public.add_friend_from_group(uuid), public.remove_friend(uuid),
  public.create_expense(jsonb), public.update_expense(uuid, jsonb, integer), public.delete_expense(uuid),
  public.restore_expense(uuid), public.add_receipt(uuid, text, text, integer), public.remove_receipt(uuid),
  public.record_settlement(jsonb), public.confirm_settlement(uuid), public.reject_settlement(uuid),
  public.cancel_settlement(uuid), public.reverse_settlement(uuid, text),
  public.mark_notifications_read(bigint[]),
  public.update_app_settings(boolean, integer), public.set_user_active(uuid, boolean), public.admin_list_users(),
  public.export_my_data(), public.delete_my_account()
to authenticated;
grant execute on function public.get_invitation_info(text) to anon, authenticated;
-- Internal helpers used inside RLS policies must be executable (they are SECURITY DEFINER and read-only)
-- bootstrap_owner_invitation is intentionally NOT granted: run it from the SQL editor only.

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
grant execute on function public._err(text) to authenticated;
