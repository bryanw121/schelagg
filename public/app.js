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
    empty: 'Rinks post public skate a week or two ahead; check another day.',
  },
  pickleball: {
    label: 'Pickleball', group: 'Open play', courts: false, noun: 'open-play sessions',
    by: 'surface',
    tabs: { indoor: { label: 'Indoor', c: 'var(--indoor)' }, outdoor: { label: 'Outdoor', c: 'var(--grass)' } },
    // Filtered by level, not surface: almost all of it is indoor, and level is what decides a session.
    filter: { tabs: { beginner: { label: 'Beginner' }, intermediate: { label: 'Intermediate' }, advanced: { label: 'Advanced' } }, match: (x, tab) => { const b = levelBands(x); return !b.length || b.includes(tab); } },
    footer: 'Confirm times, final prices, skill requirements and availability with the venue before you go. Directory listings and published recurring hours are labeled.',
    empty: 'Try another day or surface. Only source-checked open play is listed; court rentals and general park hours are not scheduled sessions.',
  },
};
const sportOf = (x) => (SPORTS[x.sport] ? x.sport : 'volleyball');
const byOf = (x) => SPORTS[sportOf(x)].by;
/** How a session is labelled and colored: its tab (e.g. Sand), or for a sport without tabs its type in the sport's color. */
function tabOf(x) {
  const sp = SPORTS[sportOf(x)];
  if (x.surface === 'unspecified') return { label: 'Court type unlisted', c: 'var(--muted)' };
  if (!sp.by) return { label: x.type || sp.label, c: sp.color };
  return sp.tabs[x[sp.by]] ?? { label: x[sp.by] || 'Other', c: 'var(--muted)' };
}
/** The filter buttons a sport offers: its level filter if it has one, else its surface tabs. */
const tabsOf = (sport) => SPORTS[sport].filter?.tabs ?? SPORTS[sport].tabs;
/**
 * Pickleball levels, read from the venue's own words, in order: Beginner / Intermediate / Advanced in
 * the title or level; else DUPR-style numbers (under 3.0 beginner, 3.0–3.99 intermediate, 4.0 up
 * advanced; "3.25+" spans upward); else "Level 1" beginner, 2–3 intermediate, 4+ advanced. Venues
 * label levels differently, so this is a best guess, and a session that states no level ([] here)
 * shows under every level.
 */
function levelBands(x) {
  const s = `${x.level || ''} ${x.title || ''}`.toLowerCase();
  const out = new Set();
  if (/beginner|novice|intro/.test(s)) out.add('beginner');
  if (/intermediate/.test(s)) out.add('intermediate');
  if (/advanced/.test(s)) out.add('advanced');
  if (!out.size) {
    const nums = [...s.replace(/level \d/g, '').matchAll(/(?<![\d.$])([2-5](?:\.\d{1,2})?)(\+?)(?![\d.])/g)].map((m) => ({ n: +m[1], up: !!m[2] }));
    if (nums.length) {
      const lo = Math.min(...nums.map((m) => m.n)), hi = nums.some((m) => m.up) ? 5.5 : Math.max(...nums.map((m) => m.n));
      const BANDS = ['beginner', 'intermediate', 'advanced'], band = (n) => (n < 3 ? 0 : n < 4 ? 1 : 2);
      BANDS.slice(band(lo), band(hi) + 1).forEach((b) => out.add(b));
    }
  }
  if (!out.size) {
    const m = s.match(/level (\d)/);
    if (m) out.add(+m[1] <= 1 ? 'beginner' : +m[1] <= 3 ? 'intermediate' : 'advanced');
  }
  return [...out];
}
const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// The chart's hours. Zoomed to the day: from the first hour anything starts to the last hour anything
// ends (at least 6 hours), so a 9am–9pm day isn't squeezed into 6am–midnight. Set by renderGlance.
let T0 = 6 * 60, T1 = 24 * 60;
const MIN_SPAN = 6 * 60;
function zoomTo(ranges) {
  const rs = ranges.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a);
  if (!rs.length) { T0 = 6 * 60; T1 = 24 * 60; return; }
  let a = Math.floor(Math.min(...rs.map((r) => r[0])) / 60) * 60;
  let b = Math.min(24 * 60, Math.ceil(Math.max(...rs.map((r) => r[1])) / 60) * 60);
  if (b - a < MIN_SPAN) { b = Math.min(24 * 60, a + MIN_SPAN); a = Math.max(0, b - MIN_SPAN); }
  T0 = a; T1 = b;
}

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// A venue's booking calendar opened on `iso` (YYYY-MM-DD) when its platform supports it.
/**
 * The same booking or sign-up page, opened on the chosen day, for the systems whose links carry a date
 * (checked against each site: it shows that day). Anything else comes back unchanged, so it opens
 * wherever the venue's own page starts. OpenCourt, Arketa, CourtReserve and PlayByPoint links don't take one.
 */
function onDay(url, iso) {
  if (!url || !iso) return url;
  let u;
  try { u = new URL(url); } catch { return url; }
  // PodPlay: /book/<area> -> /book/<area>/<date> (its own day links keep ?pod=)
  if (/\.podplay\.app$/.test(u.hostname) && /^\/book\/[^/]+(\/\d{4}-\d{2}-\d{2})?\/?$/.test(u.pathname)) {
    u.pathname = `${u.pathname.replace(/\/(\d{4}-\d{2}-\d{2})?\/?$/, '').replace(/\/\d{4}-\d{2}-\d{2}$/, '')}/${iso}`;
    return u.href;
  }
  // USTA PlayTennis "Book by date": the date rides in the hash.
  if (u.hostname === 'playtennis.usta.com' && /\/Booking\/BookByDate$/i.test(u.pathname)) return `${u.origin}${u.pathname}#?date=${iso}&role=guest`;
  // DaySmart (Dash) calendars: one day is start = end.
  if (u.hostname === 'apps.daysmartrecreation.com' && /calendar/.test(u.hash || u.pathname)) {
    const [path, q = ''] = (u.hash || '').split('?');
    const p = new URLSearchParams(q);
    p.set('start', iso); p.set('end', iso); p.delete('date');
    if (u.hash) { u.hash = `${path}?${p}`; return u.href; }
    for (const [k, v] of p) u.searchParams.set(k, v);
    return u.href;
  }
  return url;
}
const calendarOn = (venue, iso) => (venue.calendarDay && iso ? venue.calendarDay.replace('{date}', iso) : onDay(venue.calendar, iso));
/** A venue's published court price ("$40/hr"), unless it's past its review date. */
const courtPrice = (bl) => (bl?.price && !(bl.reviewBy && NOW.iso > bl.reviewBy) ? bl.price : '');

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
/**
 * Narrow bars (a 2-hour session on a phone is ~25px) show what fits: the compact range, then just
 * the start ("8p"), then nothing. The full time is always in the tooltip and the session list.
 */
function fitBarLabels() {
  for (const b of document.querySelectorAll('#cal .g-bar[data-label]')) {
    b.textContent = b.dataset.label;
    if (b.scrollWidth > b.clientWidth + 1) b.textContent = b.dataset.short;
    if (b.scrollWidth > b.clientWidth + 1) b.textContent = '';
  }
}
// Fade the chart's edge while there are more hours to scroll to (phones), shadow the pinned names once scrolled.
function edges() {
  const cal = $('cal');
  cal.classList.toggle('more-right', cal.scrollLeft + cal.clientWidth < cal.scrollWidth - 2);
  cal.classList.toggle('more-left', cal.scrollLeft > 2);
  // A tapped block's session list spans what's visible, not the whole scrollable day (clear of the right fade).
  cal.style.setProperty('--vis', `${cal.clientWidth - (cal.scrollWidth > cal.clientWidth + 2 ? 34 : 6)}px`);
}
$('cal').addEventListener('scroll', edges, { passive: true });
let fitTimer;
addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => { fitBarLabels(); edges(); }, 100); });
// Crossing the phone breakpoint changes the hour labels (every hour on phones).
matchMedia('(max-width: 699px)').addEventListener?.('change', () => { if (typeof renderGlance === 'function') renderGlance(); });

/** Compact range for chart bars: "8–10p", "9–11:30p", "10:30a–1:30p" (the full range is in the tooltip). */
function fmtRange(a, b) {
  if (!a || !b) return `${fmtT(a)}–${fmtT(b)}`;
  const part = (t) => { let [h, m] = t.split(':').map(Number); h %= 24; return { t: `${h % 12 || 12}${m ? ':' + pad(m) : ''}`, ap: h >= 12 ? 'p' : 'a' }; };
  const s = part(a), e = part(b);
  return `${s.t}${s.ap === e.ap ? '' : s.ap}–${e.t}${e.ap}`;
}
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
let state = { region: null, sport: 'volleyball', tab: 'all', di: 0, showAll: false, view: 'openplay' };
try {
  const s = JSON.parse(localStorage.getItem('vatx') || '{}');
  if (typeof s.region === 'string') state.region = s.region;
  if (SPORTS[s.sport]) state.sport = s.sport;
  const tab = s.tab ?? s.surf; // `surf` from before skating
  if (tab && tabsOf(state.sport)[tab]) state.tab = tab;
  if (typeof s.showAll === 'boolean') state.showAll = s.showAll;
  if (s.view === 'booking') state.view = s.view;
} catch {}
// A shared link (?region=austin&sport=ice_skating) wins over what was remembered.
const params = new URLSearchParams(location.search);
const urlRegion = params.get('region');
if (urlRegion) state.region = urlRegion;
const urlSport = params.get('sport');
if (params.has('view')) state.view = params.get('view') === 'booking' ? 'booking' : 'openplay';
if (SPORTS[urlSport] && urlSport !== state.sport) { state.sport = urlSport; state.tab = 'all'; }
const save = () => { try { localStorage.setItem('vatx', JSON.stringify({ region: state.region, sport: state.sport, tab: state.tab, showAll: state.showAll, view: state.view })); } catch {} };
/** Keep ?region= and ?sport= in the address bar so the view can be shared (the defaults are left out). */
function syncUrl() {
  const u = new URL(location.href);
  const single = (index?.regions?.length ?? 1) <= 1;
  if (single || !state.region) u.searchParams.delete('region'); else u.searchParams.set('region', state.region);
  if (state.sport === 'volleyball') u.searchParams.delete('sport'); else u.searchParams.set('sport', state.sport);
  if (state.view === 'booking') u.searchParams.set('view', 'booking'); else u.searchParams.delete('view');
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
  if (x.scheduleBasis === 'directory_listing') return { k: age <= 7 ? 'fresh' : age <= 21 ? 'aging' : 'stale', l: age === 0 ? 'Listed today' : `Listed ${age}d ago` };
  if (age <= 7) return { k: 'fresh', l: x.scheduleBasis === 'published_recurring_hours'
    ? (age === 0 ? 'Hours checked today' : `Hours checked ${age}d ago`)
    : (age === 0 ? 'Verified today' : `Verified ${age}d ago`) };
  if (age <= 21) return { k: 'aging', l: `Verified ${age}d ago` };
  return { k: 'stale', l: `Stale · ${age}d` };
}
const hidden = (f) => !state.showAll && (f.k === 'expired' || f.k === 'unverified' || f.k === 'canceled');
const matchTab = (x) => {
  const sp = SPORTS[sportOf(x)];
  if (state.tab === 'all' || !tabsOf(sportOf(x))[state.tab]) return true;
  if (sp.filter) return sp.filter.match(x, state.tab);
  return !sp.by || x[sp.by] === state.tab;
};

function sessionsOn(iso, { ignoreTab = false } = {}) {
  const dn = DAYS[dowOf(iso)];
  return (schedule?.sessions || [])
    .filter((x) => sportOf(x) === state.sport && (ignoreTab || matchTab(x)) && (x.date ? x.date === iso : (x.days || []).includes(dn)))
    .map((x) => ({ ...x, on: iso, f: freshness(x, iso) }));
}

function signupHtml(x) {
  if (x.f.k === 'expired' || x.f.k === 'canceled') return '';
  const s = x.signup || {}, url = onDay(s.url, x.date || x.on); // a shared calendar link opens on this session's day
  if (url && !s.dropIn) return `<a class="signup" href="${esc(url)}" target="_blank" rel="noopener">${esc(s.label || 'Sign up')} ↗</a>`;
  if (url) return `<span class="dropin">${esc(s.label || 'Drop in')}</span><a class="src" href="${esc(url)}" target="_blank" rel="noopener">Details ↗</a>`;
  return s.label ? `<span class="dropin">${esc(s.label)}</span>` : '';
}

function locationHtml(x) {
  const venue = schedule?.venues?.find((v) => v.id === x.venueId);
  if (!venue?.address) return '';
  const destination = encodeURIComponent(`${venue.name}, ${venue.address}`);
  return `<div class="location"><div>${esc(venue.address)}</div><div class="actions">
    <a class="src" href="https://www.google.com/maps/dir/?api=1&amp;destination=${destination}" target="_blank" rel="noopener">Google Maps ↗</a>
    <a class="src" href="https://maps.apple.com/directions?destination=${destination}&amp;mode=driving" target="_blank" rel="noopener">Apple Maps ↗</a>
    <button class="src copy-address" type="button" data-address="${esc(venue.address)}">Copy address</button>
    <span class="copy-status" role="status"></span></div></div>`;
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
    <span>${s.ok ? '✓' : '⚠'} ${s.checkedAt ? `checked ${ago(s.checkedAt)}` : ''}${s.ok ? ` · ${s.count} session${s.count === 1 ? '' : 's'}` : ` · couldn't read, showing last good copy`}</span>
    ${(s.warnings || []).map((w) => `<div class="note">${esc(w)}</div>`).join('')}</li>`).join('');
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
  // 📍 picks the nearest city when there are several, and orders venues by distance in any case.
  $('nearest').hidden = !('geolocation' in navigator);
  const label = here ? 'Stop ordering venues by distance from me' : many ? 'Nearest city to me, and order venues by distance' : 'Order venues by distance from me';
  $('nearest').setAttribute('aria-label', label);
  $('nearest').title = label;
  $('nearest').setAttribute('aria-pressed', String(!!here));
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
  // A level filter means nothing for court booking, so it isn't shown there.
  $('tabs').hidden = !sp.by || (sp.filter && state.view === 'booking');
  if (!sp.by) { $('tabs').innerHTML = ''; return; }
  const opts = [['all', sp.filter ? 'All levels' : 'All', null], ...Object.entries(tabsOf(state.sport)).map(([k, v]) => [k, v.label, v.c])];
  const isIn = (x, k) => k === 'all' || (sp.filter ? sp.filter.match(x, k) : x[sp.by] === k);
  $('tabs').innerHTML = opts.map(([k, l, c]) => {
    const n = state.view === 'booking' ? 0 : sessionsOn(NOW.iso, { ignoreTab: true }).filter((x) => isIn(x, k) && !hidden(x.f)).length;
    return `<button class="tab" aria-pressed="${state.tab === k}" data-tab="${esc(k)}" ${c ? `style="--c:${c}"` : ''}>${c ? '<span class="dot"></span>' : ''}${l}<span class="n">${n || ''}</span></button>`;
  }).join('');
}

function renderDays() {
  // Always shown: booking and sign-up links open on the chosen day where the venue's site allows it.
  $('days').hidden = false;
  $('days').innerHTML = WEEK.map((iso, i) => {
    const list = state.view === 'booking' ? [] : sessionsOn(iso).filter((x) => !hidden(x.f));
    const kinds = [...new Map(list.map((x) => [tabOf(x).c, tabOf(x)])).values()];
    const d = dowOf(iso);
    return `<button class="day" aria-pressed="${state.di === i}" data-di="${i}" data-iso="${iso}" aria-label="${DAY_LONG[d]} ${+iso.slice(8)}${state.view === 'booking' ? ', court bookings' : `, ${list.length} sessions`}">
      <span class="dn">${i === 0 ? 'Today' : DAYS[d]}</span><span class="dd">${+iso.slice(8)}</span>
      <span class="pips">${kinds.map((k) => `<span class="pip" style="background:${k.c}"></span>`).join('')}</span></button>`;
  }).join('');
}

// The fine print, folded away: address and directions, the source's note, and where the listing
// came from. A real button (<summary>), so it works by tap and keyboard; nothing is hover-only.
function detailsHtml(x) {
  const links = `<a class="src" href="${esc(x.source)}" target="_blank" rel="noopener">Source ↗</a>${/^https?:\/\//.test(x.priceSource ?? '') ? `<a class="src" href="${esc(x.priceSource)}" target="_blank" rel="noopener">Price source ↗</a>` : ''}${alsoOnHtml(x)}`;
  return `<details class="more"><summary>Details</summary>${locationHtml(x)}${x.note ? `<div class="note">${esc(x.note)}</div>` : ''}<div class="actions">${links}</div></details>`;
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
        <div class="t1"><span class="title">${esc(x.title)}</span><span class="pill ${live ? 'fresh' : x.f.k}">${live ? (x.scheduleBasis ? 'Scheduled now' : 'Happening now') : x.f.l}</span></div>
        <div class="venue"><b>${esc(x.venue)}</b> · ${esc(x.city)}${milesTo(x.venueId) != null ? ` · ${fmtMiles(milesTo(x.venueId))}` : ''}</div>
        <div class="meta"><span class="chip surf" style="--c:${tabOf(x).c}">${esc(tabOf(x).label)}</span>${byOf(x) === 'surface' ? `<span class="chip">${esc(x.type)}</span>` : x.surface && x.surface !== 'indoor' ? `<span class="chip">${esc(cap(x.surface))}</span>` : ''}${x.rink ? `<span>${esc(x.rink)}</span>` : ''}${x.level ? `<span>${esc(x.level)}</span>` : ''}${x.price ? `<span>· ${esc(x.price)}</span>` : ''}${capacityHtml(x)}</div>
        ${movedHtml(x)}
        <div class="actions">${signupHtml(x)}</div>
        ${detailsHtml(x)}
      </div></div>`;
  }
  if (!nowPlaced && shown.length) html += nowLabel;
  const hiddenN = all.length - shown.length;
  if (!shown.length) {
    const sp = SPORTS[state.sport];
    const label = state.tab === 'all' || !tabsOf(state.sport)[state.tab] ? '' : tabsOf(state.sport)[state.tab].label.toLowerCase() + ' ';
    const hint = !sp.courts ? sp.empty
      : state.tab === 'grass' ? `Grass has no scheduled play${region ? ` in ${esc(region.name.split(',')[0])}` : ''}. Choose Court booking to find public courts.` : 'Choose Court booking to see rental availability and free public courts.';
    html = `<div class="empty"><b>No confirmed ${label}${sp.noun}${isToday ? ' today' : ''}.</b> ${hiddenN ? `${hiddenN} ended, canceled or unconfirmed hidden. ` : ''}${hint}</div>`;
  } else if (hiddenN) html += `<div class="empty">${hiddenN} ended, canceled or unconfirmed session${hiddenN > 1 ? 's' : ''} hidden.</div>`;
  $('list').innerHTML = html;
}

function renderVenueCalendars() {
  const venues = (schedule?.venues || []).filter((v) => v.calendarLink?.sport === state.sport && /^https?:\/\//.test(v.calendarLink.url));
  $('venueCalendarsCard').hidden = state.view === 'booking' || !venues.length;
  $('venueCalendars').innerHTML = venues.map((v) => `<div class="venue-calendar">
    <b>${esc(v.name)}</b> · ${esc(v.city)}${locationHtml({ venueId: v.id })}
    <p class="note">${esc(v.calendarLink.note)}</p>
    ${v.calendarLink.details?.length ? (v.calendarLink.reviewBy && NOW.iso > v.calendarLink.reviewBy
      ? '<p class="note">Hours and general prices need rechecking. See the venue website for current details.</p>'
      : `${v.calendarLink.details.map((d) => `<p class="note"><b>${esc(d.label)}:</b> ${esc(d.text)} ${/^https?:\/\//.test(d.url) ? `<a class="src" href="${esc(d.url)}" target="_blank" rel="noopener">Source ↗</a>` : ''}</p>`).join('')}<p class="note">Details checked ${esc(v.calendarLink.reviewedOn)} · Austin local time</p>`)
      : ''}
    <a class="src" href="${esc(onDay(v.calendarLink.url, WEEK[state.di]))}" target="_blank" rel="noopener">View venue calendar ↗</a>
  </div>`).join('');
}

function renderCalendarModes() {
  const supportsBooking = ['volleyball', 'pickleball'].includes(state.sport);
  $('calendarModes').hidden = !supportsBooking;
  $('calendarModes').innerHTML = supportsBooking ? [['openplay', 'Open play'], ['booking', 'Court booking']]
    .map(([value, label]) => `<button class="tab" type="button" data-view="${value}" aria-pressed="${state.view === value}">${label}</button>`).join('') : '';
  $('sessionsPanel').hidden = state.view === 'booking';
  $('sessionFreshness').hidden = state.view === 'booking';
  const venues = (schedule?.venues || []).filter((v) => v.bookingLink?.sport === state.sport
    && /^https?:\/\//.test(v.bookingLink.url) && (state.tab === 'all' || SPORTS[state.sport].filter || !v.bookingLink.surface || v.bookingLink.surface === 'mixed' || v.bookingLink.surface === state.tab));
  // A venue with live court lanes above is booked from there; the list is everyone else.
  const live = new Set(regionCourts().flatMap((v) => v.facilities.map((f) => f.venueId)).filter(Boolean));
  for (let i = venues.length - 1; i >= 0; i--) if (live.has(venues[i].id)) venues.splice(i, 1);
  $('bookingCalendarsCard').hidden = state.view !== 'booking';
  // One line per venue: name, town, distance, a Book button. A note shared by several venues is said
  // once above the list; a venue's own note (its price, its courts) and its address fold under Details.
  const notes = venues.map((v) => v.bookingLink.note).filter(Boolean);
  const common = notes.find((n) => notes.filter((m) => m === n).length > 1) || '';
  $('bookingIntro').textContent = common || "Reserve a court for your own group on the venue's site, where you'll see open times and prices.";
  const rows = venues.map((v) => ({ v, mi: milesTo(v.id) }));
  if (here) rows.sort((a, b) => (a.mi == null) - (b.mi == null) || (a.mi != null && a.mi - b.mi));
  $('bookingCalendars').innerHTML = rows.map(({ v, mi }) => {
    const stale = v.bookingLink.reviewBy && NOW.iso > v.bookingLink.reviewBy;
    const own = stale ? 'Published rates need rechecking; consult the venue for current prices.' : v.bookingLink.note !== common ? v.bookingLink.note : '';
    const price = /^https:\/\//.test(v.bookingLink.source || '') ? `<a class="src" href="${esc(v.bookingLink.source)}" target="_blank" rel="noopener">Price source ↗</a>` : '';
    const more = locationHtml({ venueId: v.id }) + (own ? `<p class="note">${esc(own)}</p>` : '') + (price ? `<div class="actions">${price}</div>` : '');
    const cost = courtPrice(v.bookingLink);
    return `<div class="book-row"><div class="book-name"><b>${esc(v.name)}</b><span>${esc(v.city)}${mi != null ? ` · ${fmtMiles(mi)}` : ''}${cost ? ` · <b class="price">${esc(cost)}</b>` : ''}</span></div>
      <a class="signup" href="${esc(onDay(v.bookingLink.url, WEEK[state.di]))}" target="_blank" rel="noopener" aria-label="Book a court at ${esc(v.name)}">Book ↗</a>
      ${more ? `<details class="more"><summary>Details</summary>${more}</details>` : ''}</div>`;
  }).join('')
    || '<p class="note">No venue booking links for this selection.</p>';
}

function renderPublicCourts() {
  const pc = schedule?.publicCourts;
  const list = (pc?.courts || []).filter((c) => (c.sport || 'volleyball') === state.sport && (state.tab === 'all' ? true : c.surface === state.tab));
  $('courtsCard').hidden = state.view !== 'booking' || !SPORTS[state.sport].courts || state.tab === 'indoor' || !list.length;
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
  // Phones scroll a zoomed-in day (64px an hour), so every hour gets its label there.
  const span = (T1 - T0) / 60, phone = matchMedia('(max-width: 699px)').matches, step = phone || span <= 7 ? 1 : span <= 12 ? 2 : 3;
  const ticks = [];
  for (let m = T0; m <= T1; m += 60) if (((m / 60) % step === 0) || m === T0 || m === T1) ticks.push(hhmm(m));
  if (ticks.length > 2 && mins(ticks[1]) - T0 < step * 60 / 2) ticks.splice(1, 1); // keep the first two apart
  if (ticks.length > 2 && T1 - mins(ticks.at(-2)) < step * 60 / 2) ticks.splice(-2, 1);
  return `<div class="g-row g-axis" aria-hidden="true"><span class="g-lab">Time</span><div class="g-track">${ticks.map((t, i) => `<span class="${i === 0 ? 'first' : i === ticks.length - 1 ? 'last' : ''}" style="left:${pct(mins(t))}%">${tick(t)}</span>`).join('')}</div></div>`;
}

// ---------- distance (the viewer's 📍, only after they tap it) ----------
// Kept on this device only, rounded to ~100 m, forgotten after a day. Never sent anywhere: distances
// are worked out here in the browser from the venues' coordinates (config/regions/<id>/venues.json).
const HERE_KEY = 'schelagg.here', HERE_MAX_AGE = 864e5;
let here = (() => {
  try {
    const h = JSON.parse(localStorage.getItem(HERE_KEY) || 'null');
    return h && Date.now() - h.at < HERE_MAX_AGE ? h : null;
  } catch { return null; }
})();
function setHere(lat, lng) {
  here = lat == null ? null : { lat: +lat.toFixed(3), lng: +lng.toFixed(3), at: Date.now() };
  try { here ? localStorage.setItem(HERE_KEY, JSON.stringify(here)) : localStorage.removeItem(HERE_KEY); } catch { /* private mode: keep it for this visit */ }
}
/** Straight-line miles from the viewer to a venue (its own coordinates, else its parent's), or null. */
function milesTo(venueId) {
  if (!here || !venueId) return null;
  const all = schedule?.venues || [];
  let v = all.find((x) => x.id === venueId);
  if (v && v.lat == null && v.parent) v = all.find((x) => x.id === v.parent);
  if (v?.lat == null) return null;
  const rad = Math.PI / 180, dLat = (v.lat - here.lat) * rad, dLng = (v.lng - here.lng) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(here.lat * rad) * Math.cos(v.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}
// How far a venue "feels" when ordering: its distance, plus a little when every listing there is
// unconfirmed or couldn't be rechecked, so a sure thing nearby comes before a maybe slightly closer.
const UNSURE_MILES = 2;
const feltMiles = (list, mi) => mi + (list.every((x) => ['unverified', 'changed', 'stale'].includes(x.f?.k)) ? UNSURE_MILES : 0);
const fmtMiles = (mi) => (mi < 0.95 ? '<1 mi' : `${mi < 9.95 ? mi.toFixed(1) : Math.round(mi)} mi`);

/**
 * Session rows for the glance chart: one row per place (venue + rink), every session there as a
 * bar on it. Sessions at the same place that overlap (two courts at once) get extra lanes under
 * the first, so bars never cover each other.
 */
/** A session's title without a leading repeat of its venue's name ("Gus Garcia Recreation Center · Pickleball open play" → "Pickleball open play"). */
const ownTitle = (x) => x.title.replace(new RegExp(`^${x.venue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[·:–—-]?\\s*`, 'i'), '').trim();
/** The sessions behind a tapped chart block: time, title, level, price, and each one's sign-up. */
const popHtml = (items, id) => `<div class="g-pop" id="${id}">${items.map((x) => `<div class="pop-item"><span class="pop-t">${fmtT(x.start)}–${fmtT(x.end)}</span><span class="pop-w">${esc(ownTitle(x) || x.title)}${x.level && !(ownTitle(x) || x.title).includes(x.level) ? ` · ${esc(x.level)}` : ''}${x.price ? `<small>${esc(x.price)}</small>` : ''}</span><span class="pop-a">${signupHtml(x)}</span></div>`).join('')}</div>`;
let openBlock = null; // the chart block whose sessions are listed (tap again to close); reset with the day

function glanceRows(sess, nowLine) {
  const groups = new Map();
  for (const x of sess) {
    const key = `${x.venueId || x.venue}|${x.rink || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  }
  // Nearest first once the viewer has shared their location; places without coordinates follow, and
  // without a location the order stays by first session of the day (the sort is stable).
  const places = [...groups.values()].map((list) => ({ list, mi: milesTo(list[0].venueId) }));
  if (here) places.sort((a, b) => (a.mi == null) - (b.mi == null) || (a.mi != null && feltMiles(a.list, a.mi) - feltMiles(b.list, b.mi)));
  let html = '';
  for (const { list, mi } of places) {
    const first = list[0];
    const what = first.rink || (list.length === 1 ? ownTitle(first) || '1 session' : `${list.length} sessions`);
    const sub = mi == null ? what : `${what} · ${fmtMiles(mi)}`;
    // One row per venue. Sessions that overlap (Austin Pickle Ranch's five levels at 9am) become one
    // block with a count; tapping a block lists its sessions under the row, each with its sign-up.
    const blocks = [];
    for (const x of list) { // already sorted by start
      const b = blocks.at(-1), s = mins(x.start), e = mins(x.end) || 1440;
      if (b && s < b.e) { b.items.push(x); b.e = Math.max(b.e, e); } else blocks.push({ s, e, items: [x] });
    }
    const rowKey = `${first.venueId || first.venue}|${first.rink || ''}`;
    let pop = '';
    const bars = blocks.map((b) => {
      const key = `${rowKey}|${b.s}`, n = b.items.length, open = openBlock === key;
      const l = pct(b.s), w = +(pct(b.e) - l).toFixed(2);
      const range = fmtRange(hhmm(b.s), hhmm(b.e));
      const label = n > 1 ? `${range} ×${n}` : range;
      const short = n > 1 ? `×${n}` : fmtRange(hhmm(b.s), hhmm(b.s)).split('–')[1];
      const tip = n > 1 ? `${first.venue}: ${n} sessions, ${fmtT(hhmm(b.s))} to ${fmtT(hhmm(b.e))}` : `${first.venue}: ${b.items[0].title}, ${fmtT(b.items[0].start)} to ${fmtT(b.items[0].end)}`;
      const id = `pop-${blocks.indexOf(b)}-${rowKey.replace(/[^a-z0-9]/gi, '')}`;
      if (open) pop = popHtml(b.items, id);
      return `<button type="button" class="g-bar" data-block="${esc(key)}" aria-expanded="${open}" aria-controls="${id}" title="${esc(tip)}" aria-label="${esc(tip)}" data-label="${esc(label)}" data-short="${esc(short)}" style="--c:${tabOf(b.items[0]).c};left:${l}%;width:${w}%">${esc(label)}</button>`;
    }).join('');
    html += `<div class="g-row"><span class="g-lab" title="${esc(first.venue)}">${esc(first.venue)}<small>${esc(sub)}</small></span><div class="g-track">${bars}${nowLine}</div></div>${pop}`;
  }
  return html;
}

let openFacs = new Set(); // court venues whose per-court lanes are shown (the "4 courts ▾" toggle)

/**
 * One court venue in Court booking: a header (name, what's free, Book) and a single row whose
 * shading says how many courts are free each half hour. A public session on its courts (open play,
 * a meet) is one blue block that links to sign up, however many courts it takes. "N courts ▾"
 * opens a lane per court for anyone who wants the detail.
 */
function venueCourts(f, iso, dow, nowLine) {
  const book = `<a class="signup v-book" href="${esc(calendarOn(f.venue, iso))}" target="_blank" rel="noopener" aria-label="Book a court at ${esc(f.name)}">Book ↗</a>`;
  const h = f.venue.hours?.[dow];
  if (!h) return `<div class="g-venue"><span class="v-name">${esc(f.name)}<small>${esc(f.city)} · closed today</small></span>${book}</div>`;
  const open = mins(h[0]), close = mins(h[1]) || 1440, n = f.courts.length;
  const span = (a, b) => `left:${pct(a)}%;width:${(pct(b) - pct(a)).toFixed(2)}%`;
  const closedBlocks = [[T0, open], [close, T1]].filter(([a, b]) => b > a).map(([a, b]) => `<div class="g-closed" style="${span(a, b)}" title="Closed"></div>`).join('');
  const meets = sessionsOn(iso, { ignoreTab: true }).filter((x) => (x.facility === f.id || (f.venueId && x.venueId === f.venueId)) && x.start && x.end && !hidden(x.f));
  const meetFor = (s, e) => meets.find((x) => Math.abs(mins(x.start) - s) <= 15 && Math.abs(mins(x.end) - e) <= 15);
  const busy = f.courts.map((c) => (c.days[iso] || []).map(([s, e]) => [mins(s), mins(e) || 1440]));

  // Free courts per stretch of the day, between every booking edge.
  const edges = [...new Set([open, close, ...busy.flat(2)].filter((m) => m >= open && m <= close))].sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const [a, b] = [edges[i], edges[i + 1]];
    const free = busy.filter((bl) => !bl.some(([s, e]) => s < b && e > a)).length;
    const last = segs.at(-1);
    if (last && last.free === free && last.b === a) last.b = b; else segs.push({ a, b, free });
  }
  const shade = (free) => (free === n ? 'all' : free ? 'some' : 'none');
  const word = (free) => (free === n ? (n > 1 ? `all ${n} courts free` : 'free') : free ? `${free} of ${n} courts free` : 'all booked');
  // Shading only: three levels read at a glance; exact counts are in the title and the court lanes.
  const strip = segs.map(({ a, b, free }) => `<div class="g-seg ${shade(free)}" style="${span(a, b)}" title="${fmtT(hhmm(a))}–${fmtT(hhmm(b))}: ${word(free)}"></div>`).join('');
  // A public session on these courts: one block, wherever it sits.
  const used = meets.map((m) => ({ m, s: mins(m.start), e: mins(m.end) || 1440 })).filter(({ s, e }) => busy.some((bl) => bl.some(([a, b]) => meetFor(a, b) && Math.abs(a - s) <= 15 && Math.abs(b - e) <= 15)));
  // Public sessions on these courts, overlapping ones merged: tap a block to list them with sign-ups.
  const clusters = [];
  for (const u of [...used].sort((a, b) => a.s - b.s)) {
    const c = clusters.at(-1);
    if (c && u.s < c.e) { c.items.push(u.m); c.e = Math.max(c.e, u.e); } else clusters.push({ s: u.s, e: u.e, items: [u.m] });
  }
  let pop = '';
  const meetBlocks = clusters.map((c, i) => {
    const key = `court|${f.id}|${c.s}`, open = openBlock === key, k = c.items.length, id = `pop-court-${i}-${f.id.replace(/[^a-z0-9]/gi, '')}`;
    const label = k > 1 ? `${k} sessions` : /open play/i.test(c.items[0].title) ? 'Open play' : 'Session';
    const tip = k > 1 ? `${k} sessions, ${fmtT(hhmm(c.s))} to ${fmtT(hhmm(c.e))}` : `${c.items[0].title}, ${fmtT(c.items[0].start)} to ${fmtT(c.items[0].end)}`;
    if (open) pop = popHtml(c.items, id);
    return `<button type="button" class="g-bar g-meet" data-block="${esc(key)}" aria-expanded="${open}" aria-controls="${id}" title="${esc(tip)}" aria-label="${esc(f.name)}: ${esc(tip)}" data-label="${esc(label)}" data-short="${k > 1 ? `×${k}` : 'Join'}" style="--c:var(--accent);${span(c.s, c.e)}">${esc(label)}</button>`;
  }).join('');

  const anyFree = segs.filter((x) => x.free).reduce((out, x) => { const l = out.at(-1); if (l && l[1] === x.a) l[1] = x.b; else out.push([x.a, x.b]); return out; }, []).filter(([a, b]) => b - a >= 30);
  const freeText = anyFree.length ? `free <b>${anyFree.map(([a, b]) => `${fmtT(hhmm(a))}–${fmtT(hhmm(b))}`).join(', ')}</b>` : '<b class="full">fully booked</b>';
  const stale = f.venue.stale ? ' · <b class="full">showing last good data</b>' : '';
  const mi = milesTo(f.venueId);
  const cost = courtPrice(schedule?.venues?.find((v) => v.id === f.venueId)?.bookingLink);
  const where = `${esc(f.city)}${mi != null ? ` · ${fmtMiles(mi)}` : ''}${cost ? ` · <b class="price">${esc(cost)}</b>` : ''}`;
  const expanded = openFacs.has(f.id), laneId = `lanes-${f.id}`;
  const freeAria = segs.map(({ a, b, free }) => `${fmtT(hhmm(a))} to ${fmtT(hhmm(b))} ${word(free)}`).join('; ');

  let html = `<div class="g-venue"><span class="v-name">${esc(f.name)}<small>${where} · ${freeText}${stale}</small></span>${book}</div>`;
  html += `<div class="g-row"><button type="button" class="g-lab g-toggle" data-fac="${esc(f.id)}" aria-expanded="${expanded}" aria-controls="${laneId}">${n} court${n === 1 ? '' : 's'} <span aria-hidden="true">${expanded ? '▴' : '▾'}</span></button>`
    + `<div class="g-track avail"><div class="g-avail" role="img" aria-label="${esc(f.name)}: ${esc(freeAria)}">${closedBlocks}${strip}</div>${meetBlocks}${nowLine}</div></div>${pop}`;
  if (!expanded) return html;
  const lanes = f.courts.map((c, i) => {
    const bl = busy[i].map(([s, e]) => {
      const m = meetFor(s, e);
      return m ? `<a class="g-book open" href="${esc(m.signup.url)}" target="_blank" rel="noopener" style="${span(s, e)}" title="${esc(m.title)}: ${fmtT(m.start)}–${fmtT(m.end)}, sign up"></a>`
        : `<div class="g-book" style="${span(s, e)}" title="Booked ${fmtT(hhmm(s))}–${fmtT(hhmm(e))}"></div>`;
    }).join('');
    const free = freeWindows(busy[i], open, close);
    const aria = `${busy[i].length ? 'booked ' + busy[i].map(([s, e]) => `${fmtT(hhmm(s))} to ${fmtT(hhmm(e))}`).join(', ') : 'no bookings'}; ${free.length ? 'open to rent ' + free.map(([a, b]) => `${fmtT(hhmm(a))} to ${fmtT(hhmm(b))}`).join(', ') : 'no open time'}`;
    return `<div class="g-row court"><span class="g-lab">${esc(c.name.replace(/^(HP|CO) /, '').replace('Court #', 'Court '))}</span><div class="g-track lane" role="img" aria-label="${esc(c.name)}: ${aria}">${closedBlocks}${bl}${nowLine}</div></div>`;
  }).join('');
  return html + `<div class="g-lanes" id="${laneId}">${lanes}</div>`;
}

function renderGlance() {
  const iso = WEEK[state.di], isToday = state.di === 0, dow = dowOf(iso);
  if (!($('cal').dataset.key ?? '').startsWith(`${state.sport}|${state.view}|${iso}|${state.tab}|`)) openBlock = null;
  $('calTitle').textContent = `${state.view === 'booking' ? 'Court bookings' : state.sport === 'ice_skating' ? 'Public skate calendar' : 'Open-play calendar'} · ${isToday ? 'today' : fmtDate(iso, { weekday: 'short', month: 'short', day: 'numeric' })}`;
  const sess = sessionsOn(iso).filter((x) => !hidden(x.f) && x.start && x.end).sort((a, b) => a.start.localeCompare(b.start));
  // Court calendars (Skedda, OpenCourt) for this sport and region. Level chips don't apply to courts.
  const facs = state.view !== 'booking' || !liveCourts() ? [] : regionCourts().flatMap((v) => v.facilities.map((f) => ({ ...f, venue: v })))
    .filter((f) => state.tab === 'all' || SPORTS[state.sport].filter || f.surface === state.tab);
  zoomTo(state.view === 'booking'
    ? facs.map((f) => f.venue.hours?.[dow]).filter(Boolean).map(([o, c]) => [mins(o), mins(c) || 1440])
    : sess.map((x) => [mins(x.start), mins(x.end) || 1440]));
  $('cal').style.setProperty('--hours', (T1 - T0) / 60);
  const nowLine = isToday && NOW.minutes >= T0 && NOW.minutes <= T1 ? `<div class="g-now" style="left:${pct(NOW.minutes)}%"></div>` : '';
  let html = axisRow();

  if (sess.length && state.view !== 'booking') {
    html += `<div class="g-group">${SPORTS[state.sport].group}<small>tap a block to see its sessions</small></div>`;
    html += glanceRows(sess, nowLine);
  }

  html += facs.map((f) => venueCourts(f, iso, dow, nowLine)).join('');

  const volleyball = state.view === 'booking' && liveCourts(); // booking with live court calendars
  if (volleyball && !courts && !courtsError) html += `<p class="loading">Loading court calendars…</p>`;
  if (state.view === 'booking' && !facs.length && !volleyball) html += '<div class="g-group">Use the venue booking calendars below<small>Live court availability is not connected for this sport.</small></div>';
  else if (!(state.view === 'openplay' && sess.length) && !facs.length && (courts || !volleyball)) html += `<div class="g-group">Nothing timed on this day<small>${volleyball ? 'See free courts below' : 'Try another day'}</small></div>`;
  html += axisRow();
  // Booking for a sport without live court calendars: nothing to chart; the venue list below is the page.
  $('glance').hidden = state.view === 'booking' && !liveCourts();
  // Court data arriving after the first render counts as a new view, so it too starts at now.
  const cal = $('cal'), key = `${state.sport}|${state.view}|${iso}|${state.tab}|${facs.length}`, keep = cal.dataset.key === key ? cal.scrollLeft : null;
  cal.innerHTML = html;
  cal.dataset.key = key;
  fitBarLabels();
  // On a phone the hours keep a readable width and the chart scrolls sideways (names stay put).
  // A new day starts at now (today) or at its first session; a re-render keeps where you scrolled.
  if (keep != null) cal.scrollLeft = keep;
  else {
    const track = cal.querySelector('.g-track');
    // Start on a whole hour so the axis labels line up; a chart that barely overflows stays at its start.
    const at = Math.floor((isToday && NOW.minutes > T0 && NOW.minutes < T1 ? NOW.minutes - 30 : sess[0] ? mins(sess[0].start) : T0) / 60) * 60;
    const x = track ? ((at - T0) / (T1 - T0)) * track.offsetWidth : 0;
    cal.scrollLeft = cal.scrollWidth - cal.clientWidth > 60 ? Math.max(0, x) : 0;
  }
  edges();

  document.querySelector('#glance .key').hidden = !volleyball;
  $('calNote').hidden = !volleyball;
  const errs = !volleyball ? [] : [...(courts?.errors || []).filter((e) => (e.sport || 'volleyball') === state.sport), ...(courtsError ? [{ message: courtsError }] : [])];
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
    ? `Blue is a public session on those courts: tap it to sign up. Booked time is rentals and the venue's own programs; only times are shown, never who booked.${notes.length ? ` ${notes.join(' ')}` : ''}${courts ? ` Checked ${courtAge < 2 ? 'just now' : `${courtAge} min ago`}.` : ''}`
    : '';
  const mine = schedule.sources.filter((s) => (s.sport || 'volleyball') === state.sport);
  const bad = mine.filter((s) => !s.ok);
  $('sourceStatus').textContent = bad.length
    ? `Last check couldn't read: ${bad.map((s) => s.id).join(', ')}. Their sessions show "Couldn't recheck".`
    : mine.length ? `Last check read all ${mine.length} scraped ${SPORTS[state.sport].label.toLowerCase()} source${mine.length === 1 ? '' : 's'}.`
    : 'Schedules are hand-checked against published pages; live availability is not tracked.';
  const names = mine.map((s) => s.name || s.id);
  const handChecked = (schedule.sessions || []).some((x) => x.sourceId === 'manual' && sportOf(x) === state.sport);
  $('footer').innerHTML = `${names.length || handChecked ? `Sources: ${esc(list([...names, ...(handChecked ? ['hand-checked pages'] : [])]))}. ` : ''}${SPORTS[state.sport].footer}`;
  renderSourceList();
}

/** "a, b and c" */
function list(items) { return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`; }
/** This region's court calendars. With no region known (data from before regions) or a court with no region, show it. */
/** Booking shows court lanes when the sport has calendars here (volleyball always: it waits for them to load). */
const liveCourts = () => SPORTS[state.sport].courts || regionCourts().length > 0;
const regionCourts = () => (courts?.venues || []).filter((v) => (v.sport || 'volleyball') === state.sport && (!region || !v.region || v.region === region.id));

function render() { if (!schedule) return; if (!['volleyball', 'pickleball'].includes(state.sport)) state.view = 'openplay'; syncUrl(); renderRegion(); renderSports(); renderTabs(); renderDays(); renderCalendarModes(); renderGlance(); renderList(); renderVenueCalendars(); renderPublicCourts(); renderMeta(); }

$('regionPick').addEventListener('change', (e) => chooseRegion(e.target.value));
$('nearest').addEventListener('click', () => {
  if (here) { setHere(null); render(); return; } // tapping again goes back to the usual order
  navigator.geolocation.getCurrentPosition((pos) => {
    setHere(pos.coords.latitude, pos.coords.longitude);
    const at = [here.lat, here.lng];
    const d = (c) => (c[0] - at[0]) ** 2 + ((c[1] - at[1]) * Math.cos((at[0] * Math.PI) / 180)) ** 2;
    const best = [...(index?.regions ?? [])].filter((r) => r.center).sort((a, b) => d(a.center) - d(b.center))[0];
    if (best && best.id !== region?.id && (index?.regions?.length ?? 0) > 1) chooseRegion(best.id); else render();
  }, () => {}, { maximumAge: 3600e3, timeout: 10e3 });
});

document.addEventListener('click', async (e) => {
  const fac = e.target.closest('[data-fac]');
  if (fac) {
    const id = fac.dataset.fac;
    if (!openFacs.delete(id)) openFacs.add(id);
    renderGlance();
    document.querySelector(`[data-fac="${CSS.escape(id)}"]`)?.focus();
    return;
  }
  const blk = e.target.closest('[data-block]');
  if (blk) {
    openBlock = openBlock === blk.dataset.block ? null : blk.dataset.block;
    renderGlance();
    document.querySelector(`[data-block="${CSS.escape(blk.dataset.block)}"]`)?.focus();
    return;
  }
  const copy = e.target.closest('[data-address]');
  if (copy) {
    const status = copy.parentElement.querySelector('.copy-status');
    try {
      await navigator.clipboard.writeText(copy.dataset.address);
      status.textContent = 'Address copied';
    } catch {
      status.textContent = 'Could not copy. Select the address above to copy it manually.';
    }
    return;
  }
  const t = e.target.closest('[data-sport],[data-tab],[data-di],[data-view]'); if (!t) return;
  if (t.dataset.sport) { state.sport = t.dataset.sport; state.tab = 'all'; save(); }
  if (t.dataset.tab) { state.tab = t.dataset.tab; save(); }
  if (t.dataset.view) { state.view = t.dataset.view; save(); }
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
