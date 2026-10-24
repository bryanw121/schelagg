// Volley ATX front end. Two data sources:
//   data/schedule.json  sessions + public courts, rebuilt nightly by scripts/scrape.mjs
//   data/courts.json    court bookings + opening hours (Skedda), rebuilt every ~15 min by scripts/build-courts.mjs
//                       (falls back to the live api/courts endpoint when running server.js or on Vercel)

const SURF = { indoor: { label: 'Indoor', c: 'var(--indoor)' }, sand: { label: 'Sand', c: 'var(--sand)' }, grass: { label: 'Grass', c: 'var(--grass)' } };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const T0 = 6 * 60, T1 = 24 * 60;

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// "Now" in Austin, regardless of the viewer's own timezone.
function austinNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
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
const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });

const NOW = austinNow();
const WEEK = Array.from({ length: 7 }, (_, i) => addDays(NOW.iso, i));

let schedule = null, courts = null, courtsError = null;
let state = { surf: 'all', di: 0, showAll: false };
try { const s = JSON.parse(localStorage.getItem('vatx') || '{}'); if (s.surf) state.surf = s.surf; if (typeof s.showAll === 'boolean') state.showAll = s.showAll; } catch {}
const save = () => { try { localStorage.setItem('vatx', JSON.stringify({ surf: state.surf, showAll: state.showAll })); } catch {} };

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
const matchSurf = (x) => state.surf === 'all' || x.surface === state.surf;

function sessionsOn(iso, { ignoreSurf = false } = {}) {
  const dn = DAYS[dowOf(iso)];
  return (schedule?.sessions || [])
    .filter((x) => (ignoreSurf || matchSurf(x)) && (x.date ? x.date === iso : (x.days || []).includes(dn)))
    .map((x) => ({ ...x, f: freshness(x, iso) }));
}

function signupHtml(x) {
  if (x.f.k === 'expired' || x.f.k === 'canceled') return '';
  const s = x.signup || {};
  if (s.url && !s.dropIn) return `<a class="signup" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label || 'Sign up')} ↗</a>`;
  if (s.url) return `<span class="dropin">${esc(s.label || 'Drop in')}</span><a class="src" href="${esc(s.url)}" target="_blank" rel="noopener">Details ↗</a>`;
  return s.label ? `<span class="dropin">${esc(s.label)}</span>` : '';
}

// ---------- render ----------
function renderTabs() {
  const opts = [['all', 'All', null], ['indoor', 'Indoor', 'var(--indoor)'], ['sand', 'Sand', 'var(--sand)'], ['grass', 'Grass', 'var(--grass)']];
  $('tabs').innerHTML = opts.map(([k, l, c]) => {
    const n = sessionsOn(NOW.iso, { ignoreSurf: true }).filter((x) => (k === 'all' || x.surface === k) && !hidden(x.f)).length;
    return `<button class="tab" aria-pressed="${state.surf === k}" data-surf="${k}" ${c ? `style="--c:${c}"` : ''}>${c ? '<span class="dot"></span>' : ''}${l}<span class="n">${n || ''}</span></button>`;
  }).join('');
}

function renderDays() {
  $('days').innerHTML = WEEK.map((iso, i) => {
    const list = sessionsOn(iso).filter((x) => !hidden(x.f));
    const surfs = [...new Set(list.map((x) => x.surface))];
    const d = dowOf(iso);
    return `<button class="day" aria-pressed="${state.di === i}" data-di="${i}" aria-label="${DAY_LONG[d]} ${+iso.slice(8)}, ${list.length} sessions">
      <span class="dn">${i === 0 ? 'Today' : DAYS[d]}</span><span class="dd">${+iso.slice(8)}</span>
      <span class="pips">${surfs.map((s) => `<span class="pip" style="background:${SURF[s].c}"></span>`).join('')}</span></button>`;
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
        <div class="meta"><span class="chip surf" style="--c:${SURF[x.surface].c}">${SURF[x.surface].label}</span><span class="chip">${esc(x.type)}</span>${x.level ? `<span>${esc(x.level)}</span>` : ''}${x.price ? `<span>· ${esc(x.price)}</span>` : ''}</div>
        ${x.note ? `<div class="note">${esc(x.note)}</div>` : ''}
        <div class="actions">${signupHtml(x)}<a class="src" href="${esc(x.source)}" target="_blank" rel="noopener">Source ↗</a></div>
      </div></div>`;
  }
  if (!nowPlaced && shown.length) html += nowLabel;
  const hiddenN = all.length - shown.length;
  if (!shown.length) {
    const label = state.surf === 'all' ? '' : SURF[state.surf].label.toLowerCase() + ' ';
    html = `<div class="empty"><b>No confirmed ${label}sessions${isToday ? ' today' : ''}.</b> ${hiddenN ? `${hiddenN} ended, canceled or unconfirmed hidden. ` : ''}${state.surf === 'grass' ? 'Grass has no scheduled play in Austin. Use the free courts below.' : 'Courts open to rent are in the chart above, free public courts below.'}</div>`;
  } else if (hiddenN) html += `<div class="empty">${hiddenN} ended, canceled or unconfirmed session${hiddenN > 1 ? 's' : ''} hidden.</div>`;
  $('list').innerHTML = html;
}

function renderPublicCourts() {
  const pc = schedule?.publicCourts;
  const list = (pc?.courts || []).filter((c) => (state.surf === 'all' ? true : c.surface === state.surf));
  $('courtsCard').hidden = state.surf === 'indoor' || !list.length;
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

function renderGlance() {
  const iso = WEEK[state.di], isToday = state.di === 0, dow = dowOf(iso);
  $('calTitle').textContent = `Day at a glance · ${isToday ? 'today' : fmtDate(iso, { weekday: 'short', month: 'short', day: 'numeric' })}`;
  const nowLine = isToday && NOW.minutes >= T0 ? `<div class="g-now" style="left:${pct(NOW.minutes)}%"></div>` : '';
  let html = axisRow();

  const sess = sessionsOn(iso).filter((x) => !hidden(x.f) && x.start && x.end).sort((a, b) => a.start.localeCompare(b.start));
  if (sess.length) {
    html += `<div class="g-group">Open play &amp; training<small>tap a bar to sign up</small></div>`;
    html += sess.map((x) => {
      const l = pct(mins(x.start)), w = +(pct(mins(x.end)) - l).toFixed(2);
      const style = `--c:${SURF[x.surface].c};left:${l}%;width:${w}%`;
      const label = `${fmtT(x.start)}–${fmtT(x.end)}`;
      const bar = x.signup?.url
        ? `<a class="g-bar" href="${esc(x.signup.url)}" target="_blank" rel="noopener" title="${esc(x.signup.label || 'Sign up')}" style="${style}">${label}</a>`
        : `<div class="g-bar" title="${esc(x.signup?.label || '')}" style="${style}">${label}</div>`;
      return `<div class="g-row"><span class="g-lab" title="${esc(x.title)} · ${esc(x.venue)}">${esc(x.venue)}<small>${esc(x.title)}</small></span>
        <div class="g-track" role="img" aria-label="${esc(x.title)} at ${esc(x.venue)}, ${label}">${bar}${nowLine}</div></div>`;
    }).join('');
  }

  const facs = (courts?.venues || []).flatMap((v) => v.facilities.map((f) => ({ ...f, venue: v }))).filter((f) => state.surf === 'all' || f.surface === state.surf);
  html += facs.map((f) => {
    const h = f.venue.hours?.[dow];
    if (!h) return `<div class="g-group">${esc(f.name)}<small>${esc(f.city)} · closed today</small></div>`;
    const open = mins(h[0]), close = mins(h[1]) || 1440;
    const closedBlocks = [[T0, open], [close, T1]].filter(([a, b]) => b > a)
      .map(([a, b]) => `<div class="g-closed" style="left:${pct(a)}%;width:${(pct(b) - pct(a)).toFixed(2)}%" title="Closed"></div>`).join('')
      + `<div class="g-close" style="left:calc(${pct(close)}% - 2px)" title="Closes ${fmtT(hhmm(close))}"></div>`;
    const frees = [];
    const lanes = f.courts.map((c) => {
      const blocks = (c.days[iso] || []).map(([s, e]) => [mins(s), mins(e) || 1440]);
      const free = freeWindows(blocks, open, close); frees.push(free);
      const bl = blocks.map(([s, e]) => `<div class="g-book" style="left:${pct(s)}%;width:${(pct(e) - pct(s)).toFixed(2)}%" title="Booked ${fmtT(hhmm(s))}–${fmtT(hhmm(e))}"></div>`).join('');
      const aria = `${blocks.length ? 'booked ' + blocks.map(([s, e]) => `${fmtT(hhmm(s))} to ${fmtT(hhmm(e))}`).join(', ') : 'no bookings'}; ${free.length ? 'open to rent ' + free.map(([a, b]) => `${fmtT(hhmm(a))} to ${fmtT(hhmm(b))}`).join(', ') : 'no open time'}`;
      return `<div class="g-row"><span class="g-lab">${esc(c.name.replace(/^(HP|CO) /, '').replace('Court #', 'Court '))}</span><div class="g-track" role="img" aria-label="${esc(c.name)}: ${aria}">${closedBlocks}${bl}${nowLine}</div></div>`;
    }).join('');
    const anyFree = union(frees).filter(([a, b]) => b - a >= 30);
    const sum = anyFree.length ? `courts free <b>${anyFree.map(([a, b]) => `${fmtT(hhmm(a))}–${fmtT(hhmm(b))}`).join(', ')}</b>` : `<b class="full">fully booked</b>`;
    const stale = f.venue.stale ? ' · <b class="full">showing last good data</b>' : '';
    return `<div class="g-group">${esc(f.name)}<small>${esc(f.city)} · open ${fmtT(h[0])}, closes ${fmtT(hhmm(close))} · ${sum} · no public play${stale} · <a class="book" href="${esc(f.venue.calendar)}" target="_blank" rel="noopener">Book a court ↗</a></small></div>${lanes}`;
  }).join('');

  if (!courts && !courtsError) html += `<p class="loading">Loading court calendars…</p>`;
  if (!sess.length && !facs.length && courts) html += `<div class="g-group">Nothing timed on this day<small>See free courts below</small></div>`;
  html += axisRow();
  $('cal').innerHTML = html;

  const errs = [...(courts?.errors || []), ...(courtsError ? [{ message: courtsError }] : [])];
  $('calErrors').innerHTML = errs.length ? `<div class="error">Couldn't load some court calendars right now${errs.map((e) => e.calendar ? ` · <a href="${esc(e.calendar)}" target="_blank" rel="noopener">open ${esc(e.venue)} calendar ↗</a>` : '').join('')}</div>` : '';
}

function renderMeta() {
  if (!schedule) return;
  const courtAge = courts ? Math.round((Date.now() - Date.parse(courts.fetchedAt)) / 60000) : null;
  $('asof').textContent = `Schedules ${fmtDate(schedule.generatedAt.slice(0, 10))}${courts ? ` · courts ${clock(courts.fetchedAt)}` : ''}`;
  $('calNote').textContent = `Court bookings at High Point, Crossover and Treehouse Gym (home of Roots Volleyball) are club practices, events and private rentals, not public play. Who booked each slot is hidden on their calendars. Treehouse's weekday 8am–4pm blocks are school-hours holds.${courts ? ` Court calendars checked ${courtAge < 2 ? 'just now' : `${courtAge} min ago`}; they refresh about every 15 minutes.` : ''}`;
  const bad = schedule.sources.filter((s) => !s.ok);
  $('sourceStatus').textContent = bad.length
    ? `Last nightly check couldn't read: ${bad.map((s) => s.id).join(', ')}. Their sessions show "Couldn't recheck".`
    : `Last nightly check read all ${schedule.sources.length} scraped sources.`;
}

function render() { if (!schedule) return; renderTabs(); renderDays(); renderGlance(); renderList(); renderPublicCourts(); renderMeta(); }

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-surf],[data-di]'); if (!t) return;
  if (t.dataset.surf) { state.surf = t.dataset.surf; save(); }
  if (t.dataset.di) state.di = +t.dataset.di;
  render();
});
$('showAll').checked = state.showAll;
$('showAll').addEventListener('change', (e) => { state.showAll = e.target.checked; save(); render(); });

async function getJson(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); }

// Schedule first (small, static), then courts: the pre-built file, or the live API when running locally.
try { schedule = await getJson('data/schedule.json'); render(); }
catch (e) { $('list').innerHTML = `<div class="error">Couldn't load schedules: ${esc(e.message)}</div>`; }
try { courts = await getJson('data/courts.json'); }
catch { try { courts = await getJson('api/courts?days=7'); } catch (e) { courtsError = e.message; } }
render();
