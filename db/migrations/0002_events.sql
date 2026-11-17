-- Austin pop-up, seasonal and Asian-inspired events: the source of truth for what the
-- daily discovery run found. The JSON feed (public/data/events.json, published from the
-- same run) is the compatibility feed, loaded into this table by scripts/load-events.mjs.
-- Discovery runs in Muse, not GitHub Actions: Instagram is unreliable from Actions
-- runners. Written by the daily loader; read through the read-only role (db/grants.sql
-- covers tables a later migration adds via default privileges).
--
-- One row per event. The id is deterministic: 'evt-' + the first 16 hex chars of
-- sha256(source_url || '|' || start_date), so the same event found again is the same row.
-- An event that leaves the feed keeps its row with removed_at set; it is cleared again
-- if the event comes back.

create table events (
  id              text primary key,
  category        text not null check (category in ('popup', 'seasonal', 'asian-inspired')),
  title           text not null,
  venue           text,
  area            text,
  city            text,
  start_date      date not null,
  end_date        date,
  start_time      text,                            -- 'HH:MM' local; '24:00' is allowed, so not a time
  end_time        text,
  price           text,
  source_url      text not null,
  source          text,
  description     text,
  attributes      jsonb not null default '{}',
  data            jsonb not null,                  -- the feed event exactly as events.json publishes it
  first_seen_at   timestamptz not null,
  last_seen_at    timestamptz not null,
  updated_at      timestamptz not null,            -- last time a published field changed
  removed_at      timestamptz
);

create index events_current_idx on events (category, start_date) where removed_at is null;
create index events_starts_idx on events (start_date);
create index events_source_idx on events (source_url);
