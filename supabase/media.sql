-- ============================================================================
-- Valentine: photo / video / voice-note storage. Run ONCE in the SQL Editor
-- AFTER schema.sql. Safe to re-run. Without it, text and games still work but
-- sending files fails ("Not sent, tap to retry").
--
-- Files are encrypted on the sender's phone BEFORE upload; the server only
-- stores opaque bytes at <room id>/<message id>. The recipient's phone deletes
-- the file as soon as it has saved it. Anything left behind is removed by the
-- app after 7 days, or when either person deletes the room.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('valentine-media', 'valentine-media', false, 26214400)   -- 25 MB: 20 MB file + encryption overhead
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Room id from an object name like '<room uuid>/<message uuid>'; null if the name has any other shape.
create or replace function public.media_room(p_name text)
returns uuid
language sql immutable set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;
revoke all on function public.media_room(text) from public, anon;
grant execute on function public.media_room(text) to authenticated;

drop policy if exists valentine_media_select on storage.objects;
drop policy if exists valentine_media_insert on storage.objects;
drop policy if exists valentine_media_delete on storage.objects;

-- Only the two members of a room can read, add or remove that room's files.
create policy valentine_media_select on storage.objects for select to authenticated
  using (bucket_id = 'valentine-media' and public.is_member(public.media_room(name)));

create policy valentine_media_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'valentine-media'
    and public.is_member(public.media_room(name))
    and public.room_is_paired(public.media_room(name))
  );

create policy valentine_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'valentine-media' and public.is_member(public.media_room(name)));
