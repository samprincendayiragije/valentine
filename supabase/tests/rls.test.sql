-- RLS / pairing tests. Run against a scratch Postgres that has Supabase-style roles and
-- auth.uid() (see scripts/test-sql.sh). Each failed expectation raises an exception.
create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
  execute 'set local role authenticated';
end $$;

-- expect(label, sql): the statement must raise an error
create or replace function pg_temp.must_fail(p_label text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'PASS (rejected): %  [%]', p_label, sqlerrm; return;
  end;
  raise exception 'FAIL (was allowed): %', p_label;
end $$;

create or replace function pg_temp.must_equal(p_label text, p_sql text, p_expected bigint) returns void language plpgsql as $$
declare v bigint;
begin
  execute p_sql into v;
  if v is distinct from p_expected then raise exception 'FAIL: % (got %, wanted %)', p_label, v, p_expected; end if;
  raise notice 'PASS: %', p_label;
end $$;

do $$
declare
  u1 text := '00000000-0000-0000-0000-000000000001';
  u2 text := '00000000-0000-0000-0000-000000000002';
  u3 text := '00000000-0000-0000-0000-000000000003';
  k  text := repeat('A', 88);
  h1 text := repeat('1', 64);
  h2 text := repeat('2', 64);
  room uuid; room2 uuid;
  m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); mold uuid := gen_random_uuid();
  ct text := repeat('c', 32); nn text := repeat('n', 16);
begin
  -- signed-out (no sub) cannot do anything
  perform pg_temp.as_user(null);
  perform pg_temp.must_fail('no identity cannot create room', format('select public.create_room(%L,%L)', h1, k));
  reset role;

  -- U1 creates, U3 cannot see it
  perform pg_temp.as_user(u1); room := public.create_room(h1, k); reset role;
  perform pg_temp.as_user(u3);
  perform pg_temp.must_equal('outsider sees no rooms',   'select count(*) from public.rooms', 0);
  perform pg_temp.must_equal('outsider sees no members', 'select count(*) from public.members', 0);
  perform pg_temp.must_fail('wrong code rejected', format('select public.join_room(%L,%L)', repeat('9', 64), k));
  perform pg_temp.must_fail('direct insert into rooms denied', format('insert into public.rooms(code_hash,created_by) values(%L,%L)', h2, u3));
  perform pg_temp.must_fail('direct insert into members denied', format('insert into public.members(room_id,user_id,public_key) values(%L,%L,%L)', room, u3, k));
  reset role;

  -- messages are blocked until both people are in
  perform pg_temp.as_user(u1);
  perform pg_temp.must_fail('cannot post before partner joins', format('insert into public.messages(id,room_id,sender_id,ciphertext,nonce) values(%L,%L,%L,%L,%L)', m1, room, u1, ct, nn));
  perform pg_temp.must_fail('creator cannot join own code', format('select public.join_room(%L,%L)', h1, k));
  reset role;

  -- U2 joins
  perform pg_temp.as_user(u2); perform public.join_room(h1, k); reset role;
  perform pg_temp.as_user(u2);
  perform pg_temp.must_equal('joiner sees the 2 members', 'select count(*) from public.members', 2);
  reset role;

  -- a third person is rejected, even if the one-time flag were somehow reset
  perform pg_temp.as_user(u3);
  perform pg_temp.must_fail('third person rejected (code used)', format('select public.join_room(%L,%L)', h1, k));
  reset role;
  update public.rooms set code_used = false where id = room;
  perform pg_temp.as_user(u3);
  perform pg_temp.must_fail('third person rejected (room full)', format('select public.join_room(%L,%L)', h1, k));
  reset role;
  update public.rooms set code_used = true where id = room;

  -- posting rules
  perform pg_temp.as_user(u1);
  execute format('insert into public.messages(id,room_id,sender_id,ciphertext,nonce) values(%L,%L,%L,%L,%L)', m1, room, u1, ct, nn);
  perform pg_temp.must_fail('cannot post as someone else', format('insert into public.messages(id,room_id,sender_id,ciphertext,nonce) values(%L,%L,%L,%L,%L)', m2, room, u2, ct, nn));
  perform pg_temp.must_fail('bad nonce length rejected', format('insert into public.messages(id,room_id,sender_id,ciphertext,nonce) values(%L,%L,%L,%L,%L)', m2, room, u1, ct, 'short'));
  reset role;
  perform pg_temp.as_user(u3);
  perform pg_temp.must_fail('outsider cannot post into room', format('insert into public.messages(id,room_id,sender_id,ciphertext,nonce) values(%L,%L,%L,%L,%L)', m2, room, u3, ct, nn));
  perform pg_temp.must_equal('outsider cannot read messages', 'select count(*) from public.messages', 0);
  reset role;

  -- reading + delete-after-delivery
  perform pg_temp.as_user(u2);
  perform pg_temp.must_equal('recipient can read', 'select count(*) from public.messages', 1);
  perform pg_temp.must_fail('direct DELETE denied', 'delete from public.messages');
  perform pg_temp.must_fail('direct UPDATE denied', $q$update public.messages set ciphertext = 'x'$q$);
  reset role;
  perform pg_temp.as_user(u1);
  perform pg_temp.must_equal('sender cannot ack own message', format('select public.ack_messages(array[%L]::uuid[])', m1), 0);
  reset role;
  perform pg_temp.as_user(u3);
  perform pg_temp.must_equal('outsider cannot ack', format('select public.ack_messages(array[%L]::uuid[])', m1), 0);
  reset role;
  perform pg_temp.as_user(u2);
  perform pg_temp.must_equal('recipient ack deletes message', format('select public.ack_messages(array[%L]::uuid[])', m1), 1);
  reset role;
  perform pg_temp.must_equal('message gone from server after ack', 'select count(*) from public.messages', 0);

  -- 7-day expiry runs on the next insert
  alter table public.messages disable trigger messages_purge_old;   -- plant an old row without it being purged at once
  insert into public.messages(id,room_id,sender_id,ciphertext,nonce,created_at) values (mold, room, u1::uuid, ct, nn, now() - interval '8 days');
  alter table public.messages enable trigger messages_purge_old;
  perform pg_temp.must_equal('old message present before purge', 'select count(*) from public.messages', 1);
  perform pg_temp.as_user(u1);
  execute format('insert into public.messages(id,room_id,sender_id,ciphertext,nonce) values(%L,%L,%L,%L,%L)', m2, room, u1, ct, nn);
  reset role;
  perform pg_temp.must_equal('8-day-old message purged on next insert', format('select count(*) from public.messages where id = %L', mold), 0);
  perform pg_temp.must_equal('fresh message kept', format('select count(*) from public.messages where id = %L', m2), 1);

  -- anon role has no table access at all
  execute 'set local role anon';
  perform pg_temp.must_fail('anon cannot read messages', 'select * from public.messages');
  perform pg_temp.must_fail('anon cannot call join_room', format('select public.join_room(%L,%L)', h1, k));
  reset role;

  -- expired code
  perform pg_temp.as_user(u3); room2 := public.create_room(h2, k); reset role;
  update public.rooms set code_expires_at = now() - interval '1 minute' where id = room2;
  perform pg_temp.as_user(u2);
  perform pg_temp.must_fail('expired code rejected', format('select public.join_room(%L,%L)', h2, k));
  reset role;

  -- close_room: outsider no-op, member wipes everything
  perform pg_temp.as_user(u3); perform public.close_room(room); reset role;
  perform pg_temp.must_equal('outsider close_room is a no-op', format('select count(*) from public.rooms where id = %L', room), 1);
  perform pg_temp.as_user(u2); perform public.close_room(room); reset role;
  perform pg_temp.must_equal('member close_room removes room', format('select count(*) from public.rooms where id = %L', room), 0);
  perform pg_temp.must_equal('...and its members', format('select count(*) from public.members where room_id = %L', room), 0);
  perform pg_temp.must_equal('...and its messages', format('select count(*) from public.messages where room_id = %L', room), 0);

  raise notice 'ALL RLS TESTS PASSED';
end $$;
