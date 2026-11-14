// Temporary probe 6 (branch only): vexvolleyball.com, and what ties a Vex competition to its club.
import { get } from '../lib/http.js';
import { nuxtData } from '../lib/devalue.js';
import { writeFileSync } from 'node:fs';
const out = []; const say = (s) => { out.push(s); console.log(s); };
const rb = await get('https://vexvolleyball.com/robots.txt', { timeoutMs: 15000 }).catch((e) => ({ status: e.message, text: '' }));
say(`## vexvolleyball.com robots: HTTP ${rb.status}\n${rb.text.slice(0, 500)}`);
const seen = new Set(); const queue = ['https://vexvolleyball.com/'];
const reclub = new Set();
while (queue.length && seen.size < 15) {
  const u = queue.shift(); if (seen.has(u)) continue; seen.add(u);
  const r = await get(u, { timeoutMs: 20000 }).catch((e) => ({ status: e.message, text: '' }));
  const text = r.text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  say(`\n## ${u}: HTTP ${r.status}, ${r.text.length} bytes; title ${r.text.match(/<title>([^<]*)/)?.[1]}`);
  for (const w of [/league/i, /tournament|tourney/i]) { const m = text.match(w); if (m) say(`${w}: …${text.slice(Math.max(0, m.index - 150), m.index + 450)}…`); }
  for (const m of r.text.matchAll(/https?:\/\/(?:www\.)?reclub\.co\/[^"'\s<)]+/g)) reclub.add(m[0]);
  for (const m of r.text.matchAll(/href=["']([^"'#]+)["']/g)) {
    try { const n = new URL(m[1], u); if (n.hostname.replace(/^www\./, '') === 'vexvolleyball.com' && !/\.(png|jpe?g|svg|css|js|ico|webp)$/i.test(n.pathname)) queue.push(n.origin + n.pathname); } catch {}
  }
}
say(`\n## reclub links on vexvolleyball.com: ${[...reclub].join(' ') || 'none'}`);
say('\n## Feb Vex tournament record: id-like fields');
const r = await get('https://reclub.co/c/019b9ba0-375a-7273-bdcc-2a8c6da1f3db', { timeoutMs: 20000 });
const d = nuxtData(r.text)?.data ?? {};
for (const [k, v] of Object.entries(d)) {
  say(`- key ${k}: ${JSON.stringify(Object.keys(v ?? {})).slice(0, 300)}`);
  const c = v?.competition;
  if (c) for (const [ck, cv] of Object.entries(c)) if (/id$|Id$|club|group|host|organi|owner|slug|ref/i.test(ck)) say(`  ${ck}: ${JSON.stringify(cv).slice(0, 200)}`);
  for (const vk of Object.keys(v ?? {})) if (/club|group|host|organi/i.test(vk)) say(`  ${vk}: ${JSON.stringify(v[vk]).slice(0, 300)}`);
}
writeFileSync(process.env.GITHUB_STEP_SUMMARY || 'probe.md', out.join('\n') + '\n', { flag: 'a' });
