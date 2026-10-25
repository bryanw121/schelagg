// Turn Schelagg sessions into vteam `external_sessions` rows.
// Pure (no network) so it can be unit tested; scripts/sync-vteam.mjs does the I/O.
import { TZ, addDays, dowName, toMin, today } from './time.js';

const MAX_SESSION_MINUTES = 8 * 60;

/** UTC offset in minutes for Austin at a given UTC instant (e.g. -300 in CDT). */
function austinOffsetMinutes(instant) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(instant).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** "2026-10-24" + "19:30" in Austin -> ISO instant. "24:00" rolls to the next day. */
export function austinToIso(dateIso, hhmm) {
  let [h, m] = hhmm.split(':').map(Number);
  let date = dateIso;
  if (h >= 24) { h -= 24; date = addDays(dateIso, 1); }
  const [y, mo, d] = date.split('-').map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, m);
  // Two passes handle the DST boundary (offset taken at the guessed instant).
  let offset = austinOffsetMinutes(new Date(naive));
  offset = austinOffsetMinutes(new Date(naive - offset * 60000));
  return new Date(naive - offset * 60000).toISOString();
}

function surfaceOf(s) {
  return ['indoor', 'sand', 'grass'].includes(s.surface) ? s.surface : null;
}

function toRow(s, date, id, verifiedAt) {
  return {
    id,
    source_id: s.sourceId ?? 'manual',
    title: s.title,
    venue: s.venue,
    city: s.city ?? null,
    surface: surfaceOf(s),
    session_type: s.type ?? null,
    level: s.level ?? null,
    price: s.price ?? null,
    starts_at: austinToIso(date, s.start),
    ends_at: s.end ? austinToIso(date, s.end) : null,
    signup_url: s.signup?.url ?? s.source ?? null,
    signup_label: s.signup?.label ?? null,
    note: s.note ?? null,
    canceled: !!s.canceled,
    verified_at: s.verifiedAt ?? verifiedAt,
  };
}

/**
 * One row per dated session from today through `horizonDays`. Weekly sessions
 * (`days: ['Mon', ...]`) expand to each matching date inside their season
 * (`startsOn` / `validUntil`). Sessions without a start time are skipped —
 * vteam can't place them on the calendar.
 */
export function toVteamRows(sessions, { from = today(), horizonDays = 28 } = {}) {
  const until = addDays(from, horizonDays);
  const rows = [];
  for (const s of sessions) {
    if (!s.start || !s.title || !s.venue) continue;
    // All-day blocks ("open 7am–6pm") are facility hours, not a session you sign
    // up for; listing them daily would bury real sessions in the feed.
    if (s.end && toMin(s.end) - toMin(s.start) >= MAX_SESSION_MINUTES) continue;
    if (s.date) {
      if (s.date >= from && s.date <= until) rows.push(toRow(s, s.date, s.id, from));
      continue;
    }
    const days = s.days ?? [];
    if (!days.length) continue;
    for (let d = from; d <= until; d = addDays(d, 1)) {
      if (!days.includes(dowName(d))) continue;
      if (s.startsOn && d < s.startsOn) continue;
      if (s.validUntil && d > s.validUntil) continue;
      rows.push(toRow(s, d, `${s.id}-${d}`, from));
    }
  }
  return rows;
}
