-- Schelagg's own database: the source of truth for scraped sessions. The JSON files
-- (schedule.json, occurrences.json) are still published from the same run as a
-- compatibility feed. Written by the hourly scrape (lib/db.js writeRun); read by the
-- Vercel API (api/sessions.js, api/check.js) through a read-only role (db/grants.sql).

-- One row per scrape run. generated_at is the run's clock (schedule.json generatedAt);
-- it is unique so a retried write of the same run is a no-op.
create table scrape_runs (
  id            bigint generated always as identity primary key,
  started_at    timestamptz not null,
  finished_at   timestamptz not null,
  generated_at  timestamptz not null unique,
  ok            boolean not null,               -- every source scraped
  summary       jsonb not null default '[]',    -- per-source status, as schedule.json "sources"
  findings      jsonb not null default '[]',    -- lib/health.js findings for the run
  stats         jsonb not null default '{}'     -- what writeRun did: added / changed / removed ...
);

-- Every scrape source (config/sources.json), plus the hand-checked "manual" pseudo-source.
create table sources (
  id               text primary key,
  sport            text not null,
  region           text not null,
  adapter          text,
  last_ok_at       timestamptz,
  last_error       text,                          -- null once the source scrapes again
  last_checked_at  timestamptz,
  count            integer                        -- sessions on the last successful run
);

-- Current published sessions (schema v2, lib/session.js). Stable fields are columns; the
-- sport-specific ones are in attributes (same split as the feed). data is the session
-- exactly as schedule.json publishes it. A session that leaves the schedule keeps its row
-- with removed_at set; it is cleared again if the session comes back.
create table sessions (
  id              text primary key,
  source_id       text not null references sources (id),
  sport           text not null,
  region          text not null,
  timezone        text not null,
  title           text not null,
  venue           text,
  city            text,
  date            date,                            -- dated sessions
  days            text[],                          -- weekly sessions: {Mon,Wed}
  start_time      text,                            -- 'HH:MM' local; '24:00' is allowed, so not a time
  end_time        text,
  starts_on       date,                            -- weekly season bounds
  valid_until     date,
  price           text,
  level           text,
  note            text,
  signup_url      text,
  signup_label    text,
  source_url      text,
  facility        text,
  canceled        boolean not null default false,
  verified_at     date,
  check_failed    date,                            -- set while its source fails (kept last good)
  attributes      jsonb not null default '{}',
  data            jsonb not null,
  first_seen_at   timestamptz not null,
  last_seen_at    timestamptz not null,
  updated_at      timestamptz not null,            -- last time a published field changed
  removed_at      timestamptz
);
create index sessions_current_idx on sessions (sport, region) where removed_at is null;
create index sessions_source_idx on sessions (source_id);

-- The dated feed: one row per occurrence, data exactly as occurrences.json emits it.
-- Each run replaces the upcoming rows of every source that scraped; past rows stay as history.
create table occurrences (
  id             text primary key,
  session_id     text not null references sessions (id),
  source_id      text not null references sources (id),
  sport          text not null,
  region         text not null,
  timezone       text not null,
  local_date     date not null,                    -- starts_at's date in timezone
  starts_at      timestamptz not null,
  ends_at        timestamptz,
  canceled       boolean not null default false,
  data           jsonb not null,
  first_seen_at  timestamptz not null,
  updated_at     timestamptz not null
);
create index occurrences_sport_region_starts_idx on occurrences (sport, region, starts_at);
create index occurrences_starts_idx on occurrences (starts_at);
create index occurrences_session_idx on occurrences (session_id);

-- History of every session: when it appeared, what changed, when it went away.
create table session_changes (
  id          bigint generated always as identity primary key,
  run_id      bigint references scrape_runs (id),
  session_id  text not null references sessions (id),
  changed_at  timestamptz not null,
  kind        text not null check (kind in ('added', 'changed', 'removed', 'canceled', 'uncanceled')),
  before      jsonb,
  after       jsonb,
  fields      text[] not null default '{}'
);
create index session_changes_session_idx on session_changes (session_id, changed_at);
create index session_changes_changed_at_idx on session_changes (changed_at);
