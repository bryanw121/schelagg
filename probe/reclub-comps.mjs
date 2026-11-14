// Temporary probe 4 (branch only): Vex's announcements — are leagues and tournaments posted there?
import { get } from '../lib/http.js';
import { nuxtData } from '../lib/devalue.js';
import { writeFileSync } from 'node:fs';
const out = []; const say = (s) => { out.push(s); console.log(s); };
const short = (v) => JSON.stringify(v)?.slice(0, 300);
for (const path of ['', '/announcements', '/posts', '/feed', '/about']) {
  const url = `https://reclub.co/clubs/@vex_volleyball${path}`;
  const r = await get(url, { timeoutMs: 20000 }).catch((e) => ({ status: e.message, text: '' }));
  say(`\n## ${url}: HTTP ${r.status}`);
  if (!r.ok) continue;
  const d = nuxtData(r.text)?.data ?? {};
  for (const [k, v] of Object.entries(d)) {
    say(`- key ${k}: ${short(Object.keys(v ?? {}))}`);
    const club = v?.club;
    if (club) for (const ck of Object.keys(club)) if (/announ|post|news|pin|notice|compet|league/i.test(ck)) say(`  club.${ck}: ${short(club[ck])}`);
    for (const vk of Object.keys(v ?? {})) if (/announ|post|news|notice/i.test(vk)) say(`  ${vk}: ${JSON.stringify(v[vk]).slice(0, 2500)}`);
  }
  const text = r.text.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const w of [/announc/i, /league/i, /tournament/i]) {
    const m = text.match(w); if (m) say(`text ${w}: …${text.slice(Math.max(0, m.index - 150), m.index + 400)}…`);
  }
  // Announcement-like strings anywhere in the payload.
  const raw = r.text.match(/id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '';
  const strs = [...new Set((JSON.parse(raw || '[]')).filter((s) => typeof s === 'string' && /league|tournament|season|register|sign ?up/i.test(s)))];
  say(`payload strings mentioning league/tournament/season/register: ${strs.length}`);
  for (const s of strs.slice(0, 15)) say(`  > ${s.slice(0, 400).replace(/\n/g, ' ⏎ ')}`);
  // API-looking links in the page (announcement endpoints).
  const api = [...new Set([...r.text.matchAll(/https:\/\/api\.reclub\.co\/[^"'\s<]{0,80}/g)].map((m) => m[0]))];
  if (api.length) say(`api links: ${api.slice(0, 10).join(' ')}`);
}
writeFileSync(process.env.GITHUB_STEP_SUMMARY || 'probe.md', out.join('\n') + '\n', { flag: 'a' });
