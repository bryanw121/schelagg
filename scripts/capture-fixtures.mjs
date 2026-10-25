// Fetch each source's raw data API once and save it under test/fixtures/sources,
// so adapters can be written and unit-tested against real responses. Run by the
// "Capture source fixtures" workflow (workflow_dispatch) on GitHub, which can
// reach the venues; prints a status line per source.
import { mkdir, writeFile } from 'node:fs/promises';
import { repoPath } from '../lib/paths.js';

const OUT = repoPath('test/fixtures/sources');
const UA = 'Mozilla/5.0 (compatible; Schelagg/0.4; +https://github.com/bryanw121/schelagg)';
await mkdir(OUT, { recursive: true });

async function grab(name, url, init = {}) {
  try {
    const res = await fetch(url, { ...init, headers: { 'user-agent': UA, accept: 'application/json, text/html;q=0.9', ...(init.headers || {}) }, signal: AbortSignal.timeout(30000) });
    const body = await res.text();
    await writeFile(`${OUT}/${name}`, body);
    console.log(`${res.status} ${name} ${body.length}B`);
    return { status: res.status, body };
  } catch (e) {
    console.log(`ERR ${name} ${e.message}`);
    return { status: 0, body: '' };
  }
}

const start = new Date();
const end = new Date(Date.now() + 14 * 864e5);
const arketa = new URL('https://widget-api-tkaeguucxq-uc.a.run.app/ejkJj0YI8MYhO9if44ItXiKYhrt2/schedule');
arketa.searchParams.set('startDateTime', start.toISOString());
arketa.searchParams.set('endDateTime', end.toISOString());
arketa.searchParams.set('timezone', 'America/Chicago');
await grab('arketa-volleyworld-schedule.json', arketa, { headers: { origin: 'https://app.arketa.co', referer: 'https://app.arketa.co/' } });

for (const slug of ['ptx-monday-indoor-open-plays-volleyworld-pflugerville', 'wednesday-indoor-open-plays-volleyworld-pflugerville']) {
  await grab(`aces-${slug}.json`, `https://acesintexas.com/wp-json/wp/v2/pages?slug=${slug}&_fields=id,slug,modified,link,title,content`);
}

for (const club of ['vex_volleyball', 'austin-lawn-club']) {
  const { body } = await grab(`reclub-club-${club}.html`, `https://reclub.co/clubs/@${club}`);
  const links = [...new Set(body.match(/\/m\/[A-Za-z0-9]{5,8}/g) || [])].slice(0, 3);
  for (const l of links) await grab(`reclub-meet-${l.slice(3)}.html`, `https://reclub.co${l}`);
}
