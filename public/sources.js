import { pagesBase } from './pages.js';
// The sources page: for one city, every source Schelagg reads, grouped by sport (open play) and
// then leagues & tournaments, each with a link to the source, what kind of source it is, what it
// gives this week, and whether it's working. Data: data/index.json, data/regions/<id>/schedule.json
// (sources[], sessions[]), data/programs.json (sources[], programs[]).
const DATA = `${await pagesBase()}data/`; // public/pages.js
const SPORTS = { volleyball: ['Volleyball', 'open play'], pickleball: ['Pickleball', 'open play'], ice_skating: ['Ice skating', 'public skate'] };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const getJson = async (url) => { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "checked 40 min ago" style, from an ISO time. */
export function ago(iso, now = Date.now()) {
  const m = Math.round((now - Date.parse(iso)) / 60000);
  if (!Number.isFinite(m)) return 'not checked yet';
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}
const day = (iso, tz) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz });
const today = (tz, now = Date.now()) => new Date(now).toLocaleDateString('en-CA', { timeZone: tz });
const plusDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

const datedIn = (sessions, from, to) => sessions.filter((x) => x.date && x.date >= from && x.date <= to).length;
const weeklyIn = (sessions, from, to) => sessions.filter((x) => !x.date && x.days?.length && (!x.validUntil || x.validUntil >= from) && (!x.startsOn || x.startsOn <= to)).length;
/** Sessions a source gives this week, weekly time slots counted once a day they run. */
const weight = (sessions, from, to) => datedIn(sessions, from, to) + sessions.filter((x) => !x.date && x.days?.length).reduce((n, x) => n + x.days.length, 0);
/** Working sources first, the ones giving the most first; broken ones last. */
const byPriority = (a, b) => (b.ok - a.ok) || (b.n - a.n) || a.name.localeCompare(b.name);

/** What a source gives, in words: "10 sessions this week", "4 weekly time slots", both, or none. */
export function gives(sessions, from, to) {
  const dated = datedIn(sessions, from, to);
  const weekly = weeklyIn(sessions, from, to);
  const parts = [dated && plural(dated, 'session') + ' this week', weekly && plural(weekly, 'weekly time slot')].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'None posted right now';
}

/** What a leagues source gives in a city, in words. */
export function offers(programs) {
  const leagues = programs.filter((p) => p.kind === 'league').length;
  const tournaments = programs.filter((p) => p.kind === 'tournament').length;
  const parts = [leagues && plural(leagues, 'league'), tournaments && plural(tournaments, 'tournament')].filter(Boolean);
  return parts.length ? `${parts.join(' · ')} open for sign-up` : 'None open for sign-up right now';
}

/** A source's status line. */
function status(s, tz) {
  if (s.ok) return `<span class="status">Working · checked ${esc(ago(s.checkedAt))}</span>`;
  const since = s.failingSince ?? s.failedAt ?? s.checkedAt;
  const why = String(s.error ?? '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
  const kept = s.kept || s.count ? ` · showing ${plural(s.kept ?? s.count, 'listing')} from its last good check` : '';
  return `<span class="status">Not working since ${esc(day(since, tz))}${why ? ` · ${esc(why)}` : ''}${esc(kept)}</span>`;
}

/**
 * One source: by default a single line (status dot, name, what it gives; a broken source says so in
 * red); its kind, its groups or clubs and its full status show with "See details".
 */
function row(s, what, tz) {
  // A source that reads several groups or clubs links each of them (in its details), not its name.
  const several = (s.links ?? []).length > 1;
  const name = s.site && !several ? `<a href="${esc(s.site)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : `<span class="name">${esc(s.name)}</span>`;
  const links = several || (s.links?.length === 1 && !s.site)
    ? `<span class="links">${s.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a>`).join(' · ')}</span>` : '';
  const label = s.ok ? 'Working' : 'Not working';
  return `<div class="src${s.ok ? '' : ' bad'}" data-source="${esc(s.id)}"><span class="dot" role="img" aria-label="${label}" title="${label}"></span>${name}<span class="count">${esc(s.ok ? what : 'Not working')}</span><div class="more"><span class="kind">${esc(s.kind ?? '')}${s.ok ? '' : ` · ${esc(what)}`}</span>${links}${status(s, tz)}</div></div>`;
}

export function render({ region, schedule, programs, sport, now = Date.now() }) {
  const tz = region.timezone ?? 'America/Chicago';
  const from = today(tz, now), to = plusDays(from, 6);
  const sports = [...new Set((schedule.sources ?? []).map((s) => s.sport ?? 'volleyball'))]
    .sort((a, b) => (a === sport ? -1 : b === sport ? 1 : Object.keys(SPORTS).indexOf(a) - Object.keys(SPORTS).indexOf(b)));
  const out = [];
  for (const sp of sports) {
    const list = schedule.sources.filter((s) => (s.sport ?? 'volleyball') === sp);
    const ofSource = (id) => (schedule.sessions ?? []).filter((x) => x.sourceId === id);
    const week = (schedule.sessions ?? []).filter((x) => (x.sport ?? 'volleyball') === sp);
    const [label, what] = SPORTS[sp] ?? [sp, 'open play'];
    out.push(`<section class="src-group" data-sport="${esc(sp)}"><h3>${esc(label)} · ${esc(what)} <span class="n">${esc(plural(list.length, 'source'))}</span></h3>${list.map((s) => ({ ...s, ok: !!s.ok, name: s.name ?? s.id, n: weight(ofSource(s.id), from, to) })).sort(byPriority).map((s) => row(s, gives(ofSource(s.id), from, to), tz)).join('')}</section>`);
  }
  // Leagues & tournaments: sources for this city (by config or by what they list here), and
  // statewide ones (NAGVA, Texas Asian Olympics) with what they list across the state.
  const progs = programs?.programs ?? [];
  const rows = [];
  for (const s of programs?.sources ?? []) {
    const mine = progs.filter((p) => p.feed_source === s.id && p.region === region.id);
    const statewide = !(s.regions ?? []).length && !mine.length;
    if (!mine.length && !(s.regions ?? []).includes(region.id) && !statewide) continue;
    if (statewide && !progs.some((p) => p.feed_source === s.id)) continue;
    const what = statewide ? `${offers(progs.filter((p) => p.feed_source === s.id)).replace('open for sign-up', 'across the state')}` : offers(mine);
    rows.push({ ...s, ok: !!s.ok, name: s.name ?? s.id, n: statewide ? 0 : mine.length, what });
  }
  if (rows.length) out.push(`<section class="src-group" data-sport="programs"><h3>Leagues &amp; tournaments <span class="n">${esc(plural(rows.length, 'source'))}</span></h3>${rows.sort(byPriority).map((s) => row(s, s.what, tz)).join('')}</section>`);
  return out.join('') || '<p class="src-lede">No sources for this city yet.</p>';
}

/** "See details" shows every source's kind, groups and status; "Hide details" puts them away. */
function details() {
  const btn = $('details');
  btn.addEventListener('click', () => {
    const open = document.body.classList.toggle('src-details');
    btn.textContent = open ? 'Hide details' : 'See details';
    btn.setAttribute('aria-expanded', String(open));
  });
}

async function main() {
  details();
  const params = new URLSearchParams(location.search);
  const sport = SPORTS[params.get('sport')] ? params.get('sport') : 'volleyball';
  try {
    const index = await getJson(`${DATA}index.json`);
    const regions = index.regions ?? [];
    const region = regions.find((r) => r.id === params.get('region')) ?? regions[0];
    $('city').innerHTML = regions.map((r) => `<option value="${esc(r.id)}"${r.id === region.id ? ' selected' : ''}>${esc(r.name)}</option>`).join('');
    $('city').addEventListener('change', (e) => { const u = new URL(location.href); u.searchParams.set('region', e.target.value); location.href = u.href; });
    const back = new URL('./', location.href);
    if (regions.length > 1) back.searchParams.set('region', region.id);
    if (sport !== 'volleyball') back.searchParams.set('sport', sport);
    $('back').href = back.href;
    $('suggest').href = `https://github.com/bryanw121/skelly/issues/new?title=${encodeURIComponent(`Source suggestion (${region.name}): `)}&body=${encodeURIComponent('Where it is posted (a link):\n\nWhat it lists (open play, leagues, tournaments):\n')}`;
    document.title = `Skelly · Sources · ${region.name}`;
    const [schedule, programs] = await Promise.all([getJson(`${DATA}regions/${region.id}/schedule.json`), getJson(`${DATA}programs.json`).catch(() => null)]);
    $('groups').innerHTML = render({ region, schedule, programs, sport });
    $('details').hidden = false;
  } catch (e) {
    $('groups').innerHTML = `<div class="error">Couldn't load the sources right now (${esc(e.message)}).</div>`;
  }
}
if (typeof document !== 'undefined' && document.getElementById('groups')) main();
