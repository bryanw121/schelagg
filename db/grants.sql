-- Read-only access for the Vercel API (DATABASE_URL_READONLY). Run after every migration by
-- scripts/db-migrate.mjs; safe to re-run. Does nothing until a role named schelagg_reader
-- exists. Create it once in the Neon SQL editor as the owner (SQL, not the Neon console's
-- Roles page, which makes every role a member of neon_superuser):
--
--   create role schelagg_reader with login password '<generate one>';
--
-- then put its connection string in Vercel's DATABASE_URL_READONLY. Never commit it.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'schelagg_reader') then
    grant usage on schema public to schelagg_reader;
    grant select on sources, sessions, occurrences, session_changes, scrape_runs to schelagg_reader;
    -- Tables a later migration adds are readable too (when created by this same owner).
    alter default privileges in schema public grant select on tables to schelagg_reader;
  end if;
end
$$;
