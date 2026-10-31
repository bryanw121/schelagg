// Schelagg front end. Data, all rebuilt by the scrape (every 30 minutes by day, hourly overnight):
//   data/index.json                     the regions (cities): id, name, time zone, center, sports
//   data/regions/<id>/schedule.json     one region's sessions, sources and free courts
//   data/regions/<id>/<sport>.ics       its calendar subscriptions
//   data/courts.json                    court bookings + opening hours (Skedda), every region, built on deploy
//                                       (falls back to the live api/courts endpoint when running server.js or on Vercel)
// A visitor loads one region. Times are shown in the region's own time zone, wherever the viewer is.

// Each sport's filter tabs (`by`: the session field they filter on, `tabs`: its values, labels and
// colors; none for a sport that doesn't need them), the glance chart's heading, and whether it has
// court calendars. Volleyball splits by surface. Skating has no tabs: nearly all of it is indoors,
// and the few holiday outdoor rinks are labelled on the session instead.
const SPORTS = {
  volleyball: {
    label: 'Volleyball', group: 'Open play &amp; training', courts: true, noun: 'sessions',
    by: 'surface',
    tabs: { indoor: { label: 'Indoor', c: 'var(--indoor)' }, sand: { label: 'Sand', c: 'var(--sand)' }, grass: { label: 'Grass', c: 'var(--grass)' } },
    footer: 'Times change; tap “Source” before you drive out.',
  },
  ice_skating: {
    label: 'Ice skating', group: 'Public skate', courts: false, noun: 'public skate sessions',
    by: null, tabs: {}, color: 'var(--rink)',
    footer: 'Rinks close for hockey and events; tap “Source” before you drive out.',
  },
};
const sportOf = (x) => (SPORTS[x.sport] ? x.sport : 'volleyball');
const byOf = (x) => SPORTS[sportOf(x)].by;
/** How a session is labelled and colored: its tab (e.g. Sand), or for a sport without tabs its type in the sport's color. */
function tabOf(x) {
  const sp = SPORTS[sportOf(x)];
  if (!sp.by) return { label: x.type || sp.label, c: sp.color };
  return sp.tabs[x[sp.by]] ?? { label: x[sp.by] || 'Other', c: 'var(--muted)' };
}
const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const T0 = 6 * 60, T1 = 24 * 60;

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// A venue's booking calendar opened on `iso` (YYYY-MM-DD) when its platform supports it.
const calendarOn = (venue, iso) => (venue.calendarDay && iso ? venue.calendarDay.replace('{date}', iso) : venue.calendar);

// The region's time zone (set from data/index.json); everything date- and time-like uses it.
let TZ = 'America/Chicago';
// "Now" in the region, regardless of the viewer's own time zone.
function regionNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { iso: `${parts.year}-${parts.month}-${parts.day}`, minutes: +parts.hour * 60 + +parts.minute };
}
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const dowOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const dateObj = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = (iso, opts = { month: 'short', day: 'numeric' }) => dateObj(iso).toLocaleDateString('en-US', opts);
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
function fmtT(t) { if (!t) return 'TBD'; let [h, m] = t.split(':').map(Number); h %= 24; const ap = h >= 12 ? 'pm' : 'am'; return `${h % 12 || 12}${m ? ':' + pad(m) : ''}${ap}`; }
const tick = (t) => { const h = +t.slice(0, 2) % 24; return (h % 12 || 12) + (h >= 12 ? 'p' : 'a'); };
const pct = (m) => +(((Math.min(Math.max(m, T0), T1) - T0) / (T1 - T0)) * 100).toFixed(2);
const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
/** "just now", "12 min ago", "3 hr ago", "on Oct 24": how long ago an ISO time was. */
function ago(iso) {
  const m = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} hr ago`;
  return `on ${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ })}`;
}

let NOW = regionNow();
let WEEK = [];
const setClock = () => { NOW = regionNow(); WEEK = Array.from({ length: 7 }, (_, i) => addDays(NOW.iso, i)); };
setClock();

let index = null, region = null, schedule = null, courts = null, courtsError = null;
let state = { region: null, sport: 'volleyball', tab: 'all', di: 0, showAll: false };
try {
  const s = JSON.parse(localStorage.getItem('vatx') || '{}');
  if (typeof s.region === 'string') state.region = s.region;
  if (SPORTS[s.sport]) state.sport = s.sport;
  const tab = s.tab ?? s.surf; // `surf` from before skating
  if (tab && SPORTS[state.sport].tabs[tab]) state.tab = tab;
  if (typeof s.showAll === 'boolean') state.showAll = s.showAll;
} catch {}
// A shared link (?region=austin&sport=ice_skating) wins over what was remembered.
const params = new URLSearchParams(location.search);
const urlRegion = params.get('region');
if (urlRegion) state.region = urlRegion;
const urlSport = params.get('sport');
if (SPORTS[urlSport] && urlSport !== state.sport) { state.sport = urlSport; state.tab = 'all'; }
const save = () => { try { localStorage.setItem('vatx', JSON.stringify({ region: state.region, sport: state.sport, tab: state.tab, showAll: state.showAll })); } catch {} };
/** Keep ?region= and ?sport= in the address bar so the view can be shared (the defaults are left out). */
function syncUrl() {
  const u = new URL(location.href);
  const single = (index?.regions?.length ?? 1) <= 1;
  if (single || !state.region) u.searchParams.delete('region'); else u.searchParams.set('region', state.region);
  if (state.sport === 'volleyball') u.searchParams.delete('sport'); else u.searchParams.set('sport', state.sport);
  if (u.href !== location.href) history.replaceState(null, '', u);
}

// ---------- sessions ----------
function freshness(x, iso) {
  if (x.validUntil && iso > x.validUntil) return { k: 'expired', l: 'Season ended' };
  if (x.startsOn && iso < x.startsOn) return { k: 'unverified', l: `Starts ${fmtDate(x.startsOn)}` };
  if (x.canceled) return { k: 'canceled', l: 'Canceled' };
  if (!x.verifiedAt || !x.start) return { k: 'unverified', l: 'Unconfirmed' };
  if (x.checkFailed) return { k: 'changed', l: "Couldn't recheck" };
  if (x.sourceChanged) return { k: 'changed', l: 'Source changed' };
  const age = Math.max(0, Math.round((dateObj(NOW.iso) - dateObj(x.verifiedAt)) / 864e5));
  if (age <= 7) return { k: 'fresh', l: age === 0 ? 'Verified today' : `Verified ${age}d ago` };
  if (age <= 21) return { k: 'aging', l: `Verified ${age}d ago` };
  return { k: 'stale', l: `Stale · ${age}d` };
}
const hidden = (f) => !state.showAll && (f.k === 'expired' || f.k === 'unverified' || f.k === 'canceled');
const matchTab = (x) => state.tab === 'all' || !byOf(x) || x[byOf(x)] === state.tab;

function sessionsOn(iso, { ignoreTab = false } = {}) {
  const dn = DAYS[dowOf(iso)];
  return (schedule?.sessions || [])
    .filter((x) => sportOf(x) === state.sport && (ignoreTab || matchTab(x)) && (x.date ? x.date === iso : (x.days || []).includes(dn)))
    .map((x) => ({ ...x, f: freshness(x, iso) }));
}

function signupHtml(x) {
  if (x.f.k === 'expired' || x.f.k === 'canceled') return '';
  const s = x.signup || {};
  if (s.url && !s.dropIn) return `<a class="signup" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label || 'Sign up')} ↗</a>`;
  if (s.url) return `<span class="dropin">${esc(s.label || 'Drop in')}</span><a class="src" href="${esc(s.url)}" target="_blank" rel="noopener">Details ↗</a>`;
  return s.label ? `<span class="dropin">${esc(s.label)}</span>` : '';
}

// A rescheduled session says where it was ("Moved from Fri 7pm"); see lib/consolidate.js.
function movedHtml(x) {
  if (x.status !== 'rescheduled' || !x.previousStart) return '';
  const [d, t] = x.previousStart.split(' ');
  const when = d === x.date ? fmtT(t) : `${DAYS[dowOf(d)]} ${fmtDate(d)}, ${fmtT(t)}`;
  return `<div class="moved">Moved from ${esc(when)}</div>`;
}
// How full it is, only from what the source itself says (#21 busyness v1): spots left out of the
// cap, full / waitlist, or just the cap. Labelled with the source and checked at the last scrape.
function capacityHtml(x) {
  const from = `from ${sourceName(x.fieldSources?.spotsLeft ?? x.sourceId)} at the last check`;
  if (x.full) return `<span class="cap full" title="${esc(from)}">· Full${x.waitlist ? ` · ${esc(x.waitlist)} on waitlist` : ''}</span>`;
  if (Number.isFinite(x.spotsLeft) && x.capacity) return `<span class="cap" title="${esc(from)}">· ${x.spotsLeft} of ${x.capacity} spots left</span>`;
  if (x.capacity) return `<span class="cap" title="${esc(from)}">· up to ${x.capacity}</span>`;
  return '';
}
const sourceName = (id) => schedule?.sources?.find((s) => s.id === id)?.name ?? (id === 'manual' ? 'hand-checked' : id);
// The same session listed by other sources (merged into this card): a link to each.
const alsoOnHtml = (x) => (x.alsoOn || []).map((a) => `<a class="src also" href="${esc(a.signup?.url || a.source || '#')}" target="_blank" rel="noopener">Also on ${esc(sourceName(a.sourceId))} ↗</a>`).join('');

/** Each source for this sport: name, ok or not, how long ago it was checked, sessions found. */
function renderSourceList() {
  const list = (schedule?.sources || []).filter((s) => (s.sport || 'volleyball') === state.sport);
  $('sourceList').innerHTML = list.map((s) => `<li class="${s.ok ? 'ok' : 'bad'}"><b>${esc(s.name || s.id)}</b>
    <span>${s.ok ? '✓' : '⚠'} ${s.checkedAt ? `checked ${ago(s.checkedAt)}` : ''}${s.ok ? ` · ${s.count} session${s.count === 1 ? '' : 's'}` : ` · couldn't read, showing last good copy`}</span></li>`).join('');
  // Calendar subscription for this sport (public/data/<sport>.ics, rebuilt every scrape).
  const ics = new URL(`${regionData()}${state.sport}.ics`, location.href);
  $('subscribe').innerHTML = `📅 <a href="${esc(ics.href.replace(/^https?:/, 'webcal:'))}">Subscribe in your calendar</a> to see ${esc(SPORTS[state.sport].label.toLowerCase())} here, updated hourly · <a href="${esc(ics.href)}" download>.ics file</a>`;
}

// ---------- render ----------
/** The region picker: a plain label with one region, a menu (plus "nearest to me") with more. */
function renderRegion() {
  const list = index?.regions ?? [];
  const many = list.length > 1;
  $('regionName').hidden = many;
  $('regionName').textContent = region?.name ?? '';
  $('regionPick').hidden = !many;
  $('nearest').hidden = !many || !('geolocation' in navigator);
  if (many) {
    $('regionPick').innerHTML = list.map((r) => `<option value="${esc(r.id)}" ${r.id === region?.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
  }
}

function renderSports() {
  const today = (schedule?.sessions || []).filter((x) => !x.date || x.date >= NOW.iso);
  const offered = new Set(region?.sports ?? []);
  $('sports').innerHTML = Object.entries(SPORTS)
    .filter(([k]) => k === state.sport || offered.has(k) || today.some((x) => sportOf(x) === k))
    .map(([k, sp]) => `<button class="tab sport" aria-pressed="${state.sport === k}" data-sport="${k}">${sp.label}</button>`).join('');
}

function renderTabs() {
  const sp = SPORTS[state.sport];
  $('tabs').hidden = !sp.by;
  if (!sp.by) { $('tabs').innerHTML = ''; return; }
  const opts = [['all', 'All', null], ...Object.entries(sp.tabs).map(([k, v]) => [k, v.label, v.c])];
  $('tabs').innerHTML = opts.map(([k, l, c]) => {
    const n = sessionsOn(NOW.iso, { ignoreTab: true }).filter((x) => (k === 'all' || x[sp.by] === k) && !hidden(x.f)).length;
    return `<button class="tab" aria-pressed="${state.tab === k}" data-tab="${esc(k)}" ${c ? `style="--c:${c}"` : ''}>${c ? '<span class="dot"></span>' : ''}${l}<span class="n">${n || ''}</span></button>`;
  }).join('');
}

function renderDays() {
  $('days').innerHTML = WEEK.map((iso, i) => {
    const list = sessionsOn(iso).filter((x) => !hidden(x.f));
    const kinds = [...new Map(list.map((x) => [tabOf(x).c, tabOf(x)])).values()];
    const d = dowOf(iso);
    return `<button class="day" aria-pressed="${state.di === i}" data-di="${i}" aria-label="${DAY_LONG[d]} ${+iso.slice(8)}, ${list.length} sessions">
      <span class="dn">${i === 0 ? 'Today' : DAYS[d]}</span><span class="dd">${+iso.slice(8)}</span>
      <span class="pips">${kinds.map((k) => `<span class="pip" style="background:${k.c}"></span>`).join('')}</span></button>`;
  }).join('');
}

function renderList() {
  const iso = WEEK[state.di], isToday = state.di === 0;
  $('dayTitle').textContent = (isToday ? 'Today · ' : state.di === 1 ? 'Tomorrow · ' : '') + fmtDate(iso, { weekday: 'long', month: 'short', day: 'numeric' });
  const all = sessionsOn(iso).sort((a, b) => (a.start || '99').localeCompare(b.start || '99'));
  const shown = all.filter((x) => !hidden(x.f));
  const nowLabel = `<div class="now">Now · ${fmtT(hhmm(NOW.minutes))}</div>`;
  let html = '', nowPlaced = !isToday;
  for (const x of shown) {
    if (!nowPlaced && x.start && mins(x.start) > NOW.minutes) { html += nowLabel; nowPlaced = true; }
    const past = isToday && x.end && mins(x.end) <= NOW.minutes;
    const live = isToday && x.start && x.end && mins(x.start) <= NOW.minutes && NOW.minutes < mins(x.end) && x.f.k !== 'canceled';
    html += `<div class="row ${['expired', 'unverified', 'canceled'].includes(x.f.k) ? 'dim' : ''} ${past ? 'past' : ''}">
      <div class="time">${fmtT(x.start)}<small>${x.end ? 'to ' + fmtT(x.end) : ''}</small></div>
      <div class="body">
        <div class="t1"><span class="title">${esc(x.title)}</span><span class="pill ${live ? 'fresh' : x.f.k}">${live ? 'Happening now' : x.f.l}</span></div>
        <div class="venue"><b>${esc(x.venue)}</b> · ${esc(x.city)}</div>
        <div class="meta"><span class="chip surf" style="--c:${tabOf(x).c}">${esc(tabOf(x).label)}</span>${byOf(x) === 'surface' ? `<span class="chip">${esc(x.type)}</span>` : x.surface && x.surface !== 'indoor' ? `<span class="chip">${esc(cap(x.surface))}</span>` : ''}${x.rink ? `<span>${esc(x.rink)}</span>` : ''}${x.level ? `<span>${esc(x.level)}</span>` : ''}${x.price ? `<span>· ${esc(x.price)}</span>` : ''}${capacityHtml(x)}</div>
        ${movedHtml(x)}${x.note ? `<div class="note">${esc(x.note)}</div>` : ''}
        <div class="actions">${signupHtml(x)}<a class="src" href="${esc(x.source)}" target="_blank" rel="noopener">Source ↗</a>${alsoOnHtml(x)}</div>
      </div></div>`;
  }
  if (!nowPlaced && shown.length) html += nowLabel;
  const hiddenN = all.length - shown.length;
  if (!shown.length) {
    const sp = SPORTS[state.sport];
    const label = state.tab === 'all' || !sp.tabs[state.tab] ? '' : sp.tabs[state.tab].label.toLowerCase() + ' ';
    const hint = !sp.courts ? 'Rinks post public skate a week or two ahead; check another day.'
      : state.tab === 'grass' ? `Grass has no scheduled play${region ? ` in ${esc(region.name.split(',')[0])}` : ''}. Use the free courts below.` : 'Courts open to rent are in the chart above, free public courts below.';
    html = `<div class="empty"><b>No confirmed ${label}${sp.noun}${isToday ? ' today' : ''}.</b> ${hiddenN ? `${hiddenN} ended, canceled or unconfirmed hidden. ` : ''}${hint}</div>`;
  } else if (hiddenN) html += `<div class="empty">${hiddenN} ended, canceled or unconfirmed session${hiddenN > 1 ? 's' : ''} hidden.</div>`;
  $('list').innerHTML = html;
}

function renderPublicCourts() {
  const pc = schedule?.publicCourts;
  const list = (pc?.courts || []).filter((c) => (state.tab === 'all' ? true : c.surface === state.tab));
  $('courtsCard').hidden = !SPORTS[state.sport].courts || state.tab === 'indoor' || !list.length;
  $('courtsTitle').textContent = `Free public courts · ${list.length}`;
  $('courtsNote').textContent = `${pc?.note || ''} 💡 = lit.`;
  $('courts').innerHTML = list.map((c) => {
    const closed = c.closedUntil && NOW.iso < c.closedUntil;
    return `<div class="court ${closed ? 'closed' : ''}"><span>${esc(c.park)}</span><span>${closed ? `closed to ${fmtDate(c.closedUntil, { month: 'short', year: 'numeric' })}` : `${c.courts} ${c.surface}${c.lights ? ' · 💡' : ''}`}</span></div>`;
  }).join('');
}

function freeWindows(blocks, open, close) {
  const out = []; let cur = open;
  for (const [a, b] of [...blocks].sort((x, y) => x[0] - y[0])) { if (a > cur) out.push([cur, Math.min(a, close)]); cur = Math.max(cur, b); if (cur >= close) break; }
  if (cur < close) out.push([cur, close]);
  return out.filter(([a, b]) => b > a);
}
function union(lists) {
  const all = lists.flat().sort((x, y) => x[0] - y[0]), out = [];
  for (const [a, b] of all) { const l = out[out.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else out.push([a, b]); }
  return out;
}
function axisRow() {
  const ticks = ['06:00', '09:00', '12:00', '15:00', '18:00', '21:00', '24:00'];
  return `<div class="g-row g-axis" aria-hidden="true"><span class="g-lab">Time</span><div class="g-track">${ticks.map((t, i) => `<span class="${i === 0 ? 'first' : i === ticks.length - 1 ? 'last' : ''}" style="left:${pct(mins(t))}%">${tick(t)}</span>`).join('')}</div></div>`;
}

/**
 * Session rows for the glance chart: one row per place (venue + rink), every session there as a
 * bar on it. Sessions at the same place that overlap (two courts at once) get extra lanes under
 * the first, so bars never cover each other.
 */
function glanceRows(sess, nowLine) {
  const groups = new Map();
  for (const x of sess) {
    const key = `${x.venueId || x.venue}|${x.rink || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  }
  let html = '';
  for (const list of groups.values()) {
    const lanes = [];
    for (const x of list) { // already sorted by start
      const lane = lanes.find((l) => mins(l[l.length - 1].end) <= mins(x.start));
      if (lane) lane.push(x); else lanes.push([x]);
    }
    const first = list[0];
    const sub = first.rink || (list.length === 1 ? first.title : `${list.length} sessions`);
    lanes.forEach((lane, i) => {
      const bars = lane.map((x) => {
        const l = pct(mins(x.start)), w = +(pct(mins(x.end)) - l).toFixed(2);
        const style = `--c:${tabOf(x).c};left:${l}%;width:${w}%`;
        const label = `${fmtT(x.start)}–${fmtT(x.end)}`;
        const tip = `${x.title} · ${label}${x.signup?.label ? ` · ${x.signup.label}` : ''}`;
        return x.signup?.url
          ? `<a class="g-bar" href="${esc(x.signup.url)}" target="_blank" rel="noopener" title="${esc(tip)}" style="${style}">${label}</a>`
          : `<div class="g-bar" title="${esc(tip)}" style="${style}">${label}</div>`;
      }).join('');
      const aria = `${first.venue}: ${lane.map((x) => `${x.title} ${fmtT(x.start)} to ${fmtT(x.end)}`).join(', ')}`;
      const lab = i === 0 ? `<span class="g-lab" title="${esc(first.venue)}">${esc(first.venue)}<small>${esc(sub)}</small></span>` : '<span class="g-lab" aria-hidden="true"></span>';
      html += `<div class="g-row">${lab}<div class="g-track" role="img" aria-label="${esc(aria)}">${bars}${nowLine}</div></div>`;
    });
  }
  return html;
}

function renderGlance() {
  const iso = WEEK[state.di], isToday = state.di === 0, dow = dowOf(iso);
  $('calTitle').textContent = `Day at a glance · ${isToday ? 'today' : fmtDate(iso, { weekday: 'short', month: 'short', day: 'numeric' })}`;
  const nowLine = isToday && NOW.minutes >= T0 ? `<div class="g-now" style="left:${pct(NOW.minutes)}%"></div>` : '';
  let html = axisRow();

  const sess = sessionsOn(iso).filter((x) => !hidden(x.f) && x.start && x.end).sort((a, b) => a.start.localeCompare(b.start));
  if (sess.length) {
    html += `<div class="g-group">${SPORTS[state.sport].group}<small>tap a bar for details</small></div>`;
    html += glanceRows(sess, nowLine);
  }

  // Court calendars (Skedda) are volleyball courts; other sports have none yet. Only this region's.
  const facs = !SPORTS[state.sport].courts ? [] : regionCourts().flatMap((v) => v.facilities.map((f) => ({ ...f, venue: v }))).filter((f) => state.tab === 'all' || f.surface === state.tab);
  html += facs.map((f) => {
    const h = f.venue.hours?.[dow];
    if (!h) return `<div class="g-group">${esc(f.name)}<small>${esc(f.city)} · closed today</small></div>`;
    const open = mins(h[0]), close = mins(h[1]) || 1440;
    const closedBlocks = [[T0, open], [close, T1]].filter(([a, b]) => b > a)
      .map(([a, b]) => `<div class="g-closed" style="left:${pct(a)}%;width:${(pct(b) - pct(a)).toFixed(2)}%" title="Closed"></div>`).join('')
      + `<div class="g-close" style="left:calc(${pct(close)}% - 2px)" title="Closes ${fmtT(hhmm(close))}"></div>`;
    const frees = [];
    // Public meets held at this facility (e.g. Vex on a privately booked Treehouse court).
    const meets = sessionsOn(iso, { ignoreTab: true }).filter((x) => x.facility === f.id && x.start && x.end && !hidden(x.f));
    const lanes = f.courts.map((c) => {
      const blocks = (c.days[iso] || []).map(([s, e]) => [mins(s), mins(e) || 1440]);
      const free = freeWindows(blocks, open, close); frees.push(free);
      const bl = blocks.map(([s, e]) => {
        const st = `left:${pct(s)}%;width:${(pct(e) - pct(s)).toFixed(2)}%`;
        // A booking whose start and end line up with a public meet is that meet's court.
        const m = meets.find((x) => Math.abs(mins(x.start) - s) <= 15 && Math.abs(mins(x.end) - e) <= 15);
        return m
          ? `<a class="g-book open" href="${esc(m.signup.url)}" target="_blank" rel="noopener" style="${st}" title="${esc(m.title)}: ${fmtT(m.start)}–${fmtT(m.end)}, sign up">Sign up</a>`
          : `<div class="g-book" style="${st}" title="Booked ${fmtT(hhmm(s))}–${fmtT(hhmm(e))}"></div>`;
      }).join('');
      const aria = `${blocks.length ? 'booked ' + blocks.map(([s, e]) => `${fmtT(hhmm(s))} to ${fmtT(hhmm(e))}`).join(', ') : 'no bookings'}; ${free.length ? 'open to rent ' + free.map(([a, b]) => `${fmtT(hhmm(a))} to ${fmtT(hhmm(b))}`).join(', ') : 'no open time'}`;
      return `<div class="g-row"><span class="g-lab">${esc(c.name.replace(/^(HP|CO) /, '').replace('Court #', 'Court '))}</span><div class="g-track lane" role="img" aria-label="${esc(c.name)}: ${aria}">${closedBlocks}${bl}${nowLine}</div></div>`;
    }).join('');
    const anyFree = union(frees).filter(([a, b]) => b - a >= 30);
    const sum = anyFree.length ? `courts free <b>${anyFree.map(([a, b]) => `${fmtT(hhmm(a))}–${fmtT(hhmm(b))}`).join(', ')}</b>` : `<b class="full">fully booked</b>`;
    const stale = f.venue.stale ? ' · <b class="full">showing last good data</b>' : '';
    const pub = meets.length ? meets.map((m) => `<a class="book" href="${esc(m.signup.url)}" target="_blank" rel="noopener">${esc(m.title)} ${fmtT(m.start)}–${fmtT(m.end)} ↗</a>`).join(' · ') : 'no public play';
    return `<div class="g-group">${esc(f.name)}<small>${esc(f.city)} · open ${fmtT(h[0])}, closes ${fmtT(hhmm(close))} · ${sum} · ${pub}${stale} · <a class="book" href="${esc(calendarOn(f.venue, iso))}" target="_blank" rel="noopener">Book a court ↗</a></small></div>${lanes}`;
  }).join('');

  const volleyball = SPORTS[state.sport].courts;
  if (volleyball && !courts && !courtsError) html += `<p class="loading">Loading court calendars…</p>`;
  if (!sess.length && !facs.length && (courts || !volleyball)) html += `<div class="g-group">Nothing timed on this day<small>${volleyball ? 'See free courts below' : 'Try another day'}</small></div>`;
  html += axisRow();
  $('cal').innerHTML = html;

  document.querySelector('#glance .key').hidden = !volleyball;
  $('calNote').hidden = !volleyball;
  const errs = !volleyball ? [] : [...(courts?.errors || []), ...(courtsError ? [{ message: courtsError }] : [])];
  $('calErrors').innerHTML = errs.length ? `<div class="error">Couldn't load some court calendars right now${errs.map((e) => e.calendar ? ` · <a href="${esc(e.calendar)}" target="_blank" rel="noopener">open ${esc(e.venue)} calendar ↗</a>` : '').join('')}</div>` : '';
}

function renderMeta() {
  if (!schedule) return;
  const courtAge = courts ? Math.round((Date.now() - Date.parse(courts.fetchedAt)) / 60000) : null;
  // The older of the two refreshes, so "last updated" never overstates how fresh the page is.
  const stamps = [schedule.generatedAt, courts?.fetchedAt].filter(Boolean);
  const oldest = stamps.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
  $('asof').textContent = `Last updated ${ago(oldest)}`;
  $('asof').title = `Sessions ${clock(schedule.generatedAt)}${courts ? ` · court calendars ${clock(courts.fetchedAt)}` : ''}`;
  const places = regionCourts().flatMap((v) => v.facilities.map((f) => f.name));
  const notes = regionCourts().map((v) => v.note).filter(Boolean);
  $('calNote').textContent = places.length
    ? `Court bookings at ${list(places)} are mostly club practices and private rentals. Blue blocks line up with a public Reclub meet, so those courts are open to sign up. Who booked each slot is hidden on their calendars.${notes.length ? ` ${notes.join(' ')}` : ''}${courts ? ` Court calendars checked ${courtAge < 2 ? 'just now' : `${courtAge} min ago`}; they refresh with each schedule update.` : ''}`
    : '';
  const mine = schedule.sources.filter((s) => (s.sport || 'volleyball') === state.sport);
  const bad = mine.filter((s) => !s.ok);
  $('sourceStatus').textContent = bad.length
    ? `Last check couldn't read: ${bad.map((s) => s.id).join(', ')}. Their sessions show "Couldn't recheck".`
    : `Last check read all ${mine.length} scraped ${SPORTS[state.sport].label.toLowerCase()} source${mine.length === 1 ? '' : 's'}.`;
  const names = mine.map((s) => s.name || s.id);
  const handChecked = (schedule.sessions || []).some((x) => x.sourceId === 'manual' && sportOf(x) === state.sport);
  $('footer').innerHTML = `${names.length || handChecked ? `Sources: ${esc(list([...names, ...(handChecked ? ['hand-checked pages'] : [])]))}. ` : ''}${SPORTS[state.sport].footer}`;
  renderSourceList();
}

/** "a, b and c" */
function list(items) { return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`; }
/** This region's court calendars. With no region known (data from before regions) or a court with no region, show it. */
const regionCourts = () => (courts?.venues || []).filter((v) => !region || !v.region || v.region === region.id);

function render() { if (!schedule) return; syncUrl(); renderRegion(); renderSports(); renderTabs(); renderDays(); renderGlance(); renderList(); renderPublicCourts(); renderMeta(); }

$('regionPick').addEventListener('change', (e) => chooseRegion(e.target.value));
$('nearest').addEventListener('click', () => {
  navigator.geolocation.getCurrentPosition((pos) => {
    const here = [pos.coords.latitude, pos.coords.longitude];
    const d = (c) => (c[0] - here[0]) ** 2 + ((c[1] - here[1]) * Math.cos((here[0] * Math.PI) / 180)) ** 2;
    const best = [...(index?.regions ?? [])].filter((r) => r.center).sort((a, b) => d(a.center) - d(b.center))[0];
    if (best) chooseRegion(best.id);
  }, () => {}, { maximumAge: 3600e3, timeout: 10e3 });
});

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-sport],[data-tab],[data-di]'); if (!t) return;
  if (t.dataset.sport) { state.sport = t.dataset.sport; state.tab = 'all'; save(); }
  if (t.dataset.tab) { state.tab = t.dataset.tab; save(); }
  if (t.dataset.di) state.di = +t.dataset.di;
  render();
});
$('showAll').checked = state.showAll;
$('showAll').addEventListener('change', (e) => { state.showAll = e.target.checked; save(); render(); });

// The scrape publishes data files to GitHub Pages only (the data branch); the copy Vercel
// bundles from main goes stale. So the Vercel-hosted page reads them from Pages (which allows
// cross-origin reads). Pages itself and local server.js use their own data/ folder.
const DATA = location.hostname.endsWith('.vercel.app') ? 'https://bryanw121.github.io/schelagg/data/' : 'data/';

async function getJson(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); }
/** Where this region's files are; data/ itself when there's no index (data published before regions). */
const regionData = () => (index && region ? `${DATA}regions/${region.id}/` : DATA);

/** Switch to a region: its time zone, its schedule, a sport it has. */
async function chooseRegion(id) {
  region = index?.regions?.find((r) => r.id === id) ?? index?.regions?.[0] ?? null;
  state.region = region?.id ?? null;
  TZ = region?.timezone ?? TZ;
  setClock();
  state.di = 0;
  try {
    schedule = await getJson(`${regionData()}schedule.json`);
  } catch (e) {
    schedule = null;
    $('list').innerHTML = `<div class="error">Couldn't load schedules: ${esc(e.message)}</div>`;
    return;
  }
  if (region?.sports?.length && !region.sports.includes(state.sport)) { state.sport = region.sports[0]; state.tab = 'all'; }
  save();
  render();
}

// The regions first, then the chosen region's schedule, then court calendars: the pre-built
// file, or the live API when running locally. Without an index (data published before regions
// existed) the combined data/schedule.json is the one region.
try { index = await getJson(`${DATA}index.json`); } catch { index = null; }
if (index?.regions?.length) await chooseRegion(state.region);
else {
  try { schedule = await getJson(`${DATA}schedule.json`); render(); }
  catch (e) { $('list').innerHTML = `<div class="error">Couldn't load schedules: ${esc(e.message)}</div>`; }
}
try { courts = await getJson(`${DATA}courts.json`); }
catch { try { courts = await getJson('api/courts?days=7'); } catch (e) { courtsError = e.message; } }
render();
setInterval(() => renderMeta(), 60_000); // keep "x min ago" current while the page stays open
