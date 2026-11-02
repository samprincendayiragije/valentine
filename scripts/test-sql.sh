#!/usr/bin/env bash
# Runs supabase/schema.sql (twice, to prove it is re-runnable) and the RLS tests against a
# throwaway local Postgres with Supabase-style roles. Needs postgresql installed; no network.
set -euo pipefail
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
DIR=$(mktemp -d); chmod 777 "$DIR"
PORT=54329
run_pg() { su postgres -c "$*"; }
run_pg "$PGBIN/initdb -D $DIR/data -A trust >/dev/null"
run_pg "$PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log -w start >/dev/null"
trap 'run_pg "$PGBIN/pg_ctl -D $DIR/data -m immediate stop >/dev/null" || true' EXIT
PSQL="psql -h $DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
run_pg "$PSQL -d postgres" <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create publication supabase_realtime;
SQL
run_pg "$PSQL -d postgres -f $PWD/supabase/schema.sql" 2>&1 | grep -v "^$" || true
echo "--- schema applied once; applying again (idempotency) ---"
run_pg "$PSQL -d postgres -f $PWD/supabase/schema.sql" 2>&1 | grep -v "^$" || true
echo "--- RLS tests ---"
run_pg "$PSQL -d postgres -f $PWD/supabase/tests/rls.test.sql" 2>&1
