-- ============================================================================
-- Valentine private chat: Supabase schema
-- Run once in a NEW Supabase project: Dashboard -> SQL Editor -> paste -> Run.
-- Safe to re-run.
--
-- Prerequisite: Authentication -> Providers -> enable "Allow anonymous sign-ins".
--
-- What the server stores: room id, the two members' PUBLIC keys, and per message
-- an id, sender id, ciphertext, nonce and timestamp. Never plaintext or private keys.
-- ============================================================================

-- ---------- tables ----------
create table if not exists public.rooms (
  id              uuid primary key default gen_random_uuid(),
  code_hash       text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  code_expires_at timestamptz not null default now() + interval '30 minutes',
  code_used       boolean not null default false
);

create table if not exists public.members (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  user_id    uuid not null,
  public_key text not null check (length(public_key) = 88),  -- base64 of 65-byte P-256 point
  joined_at  timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.messages (
  id         uuid primary key,                                -- client-generated, bound into AES-GCM AAD
  room_id    uuid not null references public.rooms(id) on delete cascade,
  sender_id  uuid not null,
  ciphertext text not null check (length(ciphertext) between 24 and 16000),
  nonce      text not null check (length(nonce) = 16),        -- base64 of 12 bytes
  created_at timestamptz not null default now()
);

create index if not exists messages_room_created_idx on public.messages (room_id, created_at);
create index if not exists messages_created_idx      on public.messages (created_at);

-- ---------- helpers (SECURITY DEFINER so RLS policies don't recurse) ----------
create or replace function public.is_member(p_room uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.room_id = p_room and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.room_is_paired(p_room uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select count(*) from public.members m where m.room_id = p_room) = 2;
$$;

-- ---------- row level security ----------
alter table public.rooms    enable row level security;
alter table public.members  enable row level security;
alter table public.messages enable row level security;

drop policy if exists rooms_select_member    on public.rooms;
drop policy if exists members_select_member  on public.members;
drop policy if exists messages_select_member on public.messages;
drop policy if exists messages_insert_member on public.messages;

-- Only members of a room can see it, its members, or its messages.
create policy rooms_select_member    on public.rooms    for select to authenticated using (public.is_member(id));
create policy members_select_member  on public.members  for select to authenticated using (public.is_member(room_id));
create policy messages_select_member on public.messages for select to authenticated using (public.is_member(room_id));

-- A member can post to a room only as themselves, and only once both people have joined.
create policy messages_insert_member on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.is_member(room_id)
    and public.room_is_paired(room_id)
  );

-- No UPDATE or DELETE policies exist: nobody can edit or delete rows directly.
-- Rooms and members are written only through the functions below.

-- ---------- table privileges: deny by default, then grant the minimum ----------
revoke all on public.rooms, public.members, public.messages from anon, authenticated, public;
grant select on public.rooms, public.members, public.messages to authenticated;
grant insert on public.messages to authenticated;

-- ---------- pairing ----------
create or replace function public.create_room(p_code_hash text, p_public_key text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_room uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  -- tidy: drop this user's earlier rooms that never got a second person, and stale codes
  delete from public.rooms r
   where (r.created_by = v_uid or r.code_expires_at < now())
     and (select count(*) from public.members m where m.room_id = r.id) < 2;

  insert into public.rooms (code_hash, created_by) values (p_code_hash, v_uid) returning id into v_room;
  insert into public.members (room_id, user_id, public_key) values (v_room, v_uid, p_public_key);
  return v_room;
end $$;

create or replace function public.join_room(p_code_hash text, p_public_key text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_room public.rooms;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  -- lock the row so two people cannot join the same room at the same moment
  select * into v_room from public.rooms where code_hash = p_code_hash for update;

  -- one generic message for every failure, so a wrong guess learns nothing
  if not found
     or v_room.code_used
     or v_room.code_expires_at < now()
     or v_room.created_by = v_uid
     or (select count(*) from public.members m where m.room_id = v_room.id) >= 2
  then
    raise exception 'invalid or expired code';
  end if;

  insert into public.members (room_id, user_id, public_key) values (v_room.id, v_uid, p_public_key);
  update public.rooms set code_used = true where id = v_room.id;   -- one-time
  return v_room.id;
end $$;

-- ---------- delete after delivery ----------
-- The RECIPIENT confirms receipt. Only messages sent by the OTHER member of a room the
-- caller belongs to can be removed this way: you cannot delete your own sent messages
-- (they would vanish before delivery) and you cannot touch any other room.
create or replace function public.ack_messages(p_ids uuid[])
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  delete from public.messages m
   where m.id = any(p_ids)
     and m.sender_id <> (select auth.uid())
     and public.is_member(m.room_id);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Either person can close the room; this wipes the room, both public keys and all messages.
create or replace function public.close_room(p_room uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if public.is_member(p_room) then
    delete from public.rooms where id = p_room;   -- cascades to members and messages
  end if;
end $$;

revoke all on function public.create_room(text, text), public.join_room(text, text),
              public.ack_messages(uuid[]), public.close_room(uuid),
              public.is_member(uuid), public.room_is_paired(uuid)
  from public, anon, authenticated;
grant execute on function public.create_room(text, text), public.join_room(text, text),
              public.ack_messages(uuid[]), public.close_room(uuid)
  to authenticated;
-- RLS policies run with the caller's privileges, so the two read-only helpers they call need EXECUTE.
-- They only ever answer about the caller's own auth.uid(), so exposing them leaks nothing.
grant execute on function public.is_member(uuid), public.room_is_paired(uuid) to authenticated;

-- ---------- 7-day expiry ----------
-- Guarantee 1 (always works, no extensions): every insert purges anything older than 7 days.
create or replace function public.purge_old_messages()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.messages where created_at < now() - interval '7 days';
  return null;
end $$;
revoke all on function public.purge_old_messages() from public, anon, authenticated;

drop trigger if exists messages_purge_old on public.messages;
create trigger messages_purge_old after insert on public.messages
  for each statement execute function public.purge_old_messages();

-- Guarantee 2 (hourly, even if nobody sends anything): pg_cron, if the project allows it.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('valentine-purge')
    where exists (select 1 from cron.job where jobname = 'valentine-purge');
  perform cron.schedule('valentine-purge', '17 * * * *',
    $job$ delete from public.messages where created_at < now() - interval '7 days' $job$);
exception when others then
  raise notice 'pg_cron not available (%). The per-insert purge still enforces the 7-day limit. '
               'Enable pg_cron under Database -> Extensions for hourly purging.', sqlerrm;
end $$;

-- ---------- realtime ----------
-- Realtime applies the SELECT policies above, so each person only receives their room's rows.
do $$
begin
  begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.members;  exception when duplicate_object then null; end;
exception when undefined_object then
  raise notice 'supabase_realtime publication not found; enable Realtime for these tables in the dashboard.';
end $$;
