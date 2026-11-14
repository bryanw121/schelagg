// Temporary probe (branch only, never merged): where can Texas volleyball competitions be found on Reclub?
import { get } from '../lib/http.js';
import { nuxtData } from '../lib/devalue.js';
import { competitionUrls, competitionOf } from '../lib/programs/reclub.js';
const out = [];
const say = (s) => { out.push(s); console.log(s); };
const clubs = ['vex_volleyball', 'austin-lawn-club', 'ync-volleyball-dallas-texas-usa-95', 'north-houston', 'cinco-ranch-volleyball-club'];
const keysWith = (obj, re, depth = 0, path = '', acc = []) => {
  if (!obj || typeof obj !== 'object' || depth > 4) return acc;
  for (const [k, v] of Object.entries(obj)) { const p = path ? `${path}.${k}` : k; if (re.test(k)) acc.push(p); keysWith(v, re, depth + 1, p, acc); }
  return acc;
};
say('## Club pages');
for (const slug of clubs) {
  for (const suffix of ['', '/competitions', '?tab=competitions', '/events']) {
    const url = `https://reclub.co/clubs/@${slug}${suffix}`;
    const r = await get(url, { timeoutMs: 20000 }).catch((e) => ({ ok: false, status: e.message, text: '' }));
    const comps = [...new Set([...r.text.matchAll(/\/c\/([0-9a-f-]{36})/g)].map((m) => m[1]))];
    const meets = new Set([...r.text.matchAll(/\/m\/([A-Za-z0-9]{4,12})/g)].map((m) => m[1])).size;
    let keys = [];
    try { keys = keysWith(nuxtData(r.text)?.data, /compet|tournament|league/i).slice(0, 12); } catch {}
    const apis = [...new Set([...r.text.matchAll(/https?:\/\/[a-z0-9.-]*reclub[a-z0-9.-]*\/[A-Za-z0-9_\/.-]{0,40}/g)].map((m) => m[0]))].filter((u) => /api/i.test(u)).slice(0, 6);
    say(`- ${slug}${suffix}: HTTP ${r.status}, ${r.text.length} bytes, competitions linked ${comps.length}${comps.length ? ` (${comps.slice(0, 3).join(', ')})` : ''}, meets ${meets}, data keys ${JSON.stringify(keys)}${apis.length ? `, api urls ${JSON.stringify(apis)}` : ''}`);
  }
}
say('\n## Sitemaps');
for (const url of ['https://reclub.co/sitemap.xml', 'https://reclub.co/sitemap_index.xml', 'https://reclub.co/__sitemap__/en-US.xml', 'https://reclub.co/robots.txt']) {
  const r = await get(url, { timeoutMs: 30000 }).catch((e) => ({ ok: false, status: e.message, text: '' }));
  const locs = [...r.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const kinds = {};
  for (const l of locs) { const k = l.replace(/^https:\/\/reclub\.co/, '').split('/').slice(0, 2).join('/'); kinds[k] = (kinds[k] ?? 0) + 1; }
  say(`- ${url}: HTTP ${r.status}, ${locs.length} locs, kinds ${JSON.stringify(Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 12))}${url.endsWith('robots.txt') ? `\n\n\`\`\`\n${r.text.slice(0, 800)}\n\`\`\`` : ''}`);
  if (/en-US/.test(url)) {
    const urls = competitionUrls(r.text);
    const lastmods = [...r.text.matchAll(/<url><loc>https:\/\/reclub\.co\/c\/[^<]+<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => m[1]).filter(Boolean);
    say(`  - competitions in sitemap: ${urls.length}; lastmod first/last: ${lastmods[0]} / ${lastmods.at(-1)}`);
    // Sample competition pages across the whole list: sport, place, dates, organizer fields.
    const step = Math.max(1, Math.floor(urls.length / 300));
    const sample = urls.filter((_, i) => i % step === 0).slice(0, 300);
    let read = 0, vb = 0, tx = 0, usa = 0; const txRows = [], fieldSet = new Set(), countries = {};
    const t0 = Date.now();
    for (const u of sample) {
      if (Date.now() - t0 > 8 * 60e3) break;
      const p = await get(u, { timeoutMs: 15000 }).catch(() => null);
      if (!p?.ok) continue;
      read++;
      const c = competitionOf(p.text); if (!c) continue;
      if (read <= 3) Object.keys(c).forEach((k) => fieldSet.add(k));
      const addr = c.venue?.location?.address ?? '';
      const country = addr.split(',').at(-1)?.trim() || '?'; countries[country] = (countries[country] ?? 0) + 1;
      if (/United States/i.test(addr)) usa++;
      if (c.sportId === 10) vb++;
      if (/,\s*(TX|Texas)\b/i.test(addr)) { tx++; txRows.push(`${c.sportId === 10 ? 'VB' : 'sport ' + c.sportId} · ${c.name} · ${addr} · club ${c.clubId ?? c.club?.id ?? c.organizer?.id ?? '?'} · ${u}`); }
    }
    say(`  - sampled ${read} of ${sample.length} (every ${step}th): volleyball ${vb}, US ${usa}, Texas ${tx}`);
    say(`  - countries: ${JSON.stringify(Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 10))}`);
    say(`  - competition fields: ${[...fieldSet].join(', ')}`);
    for (const row of txRows.slice(0, 25)) say(`    - ${row}`);
  }
}
import('node:fs').then(({ writeFileSync }) => writeFileSync(process.env.GITHUB_STEP_SUMMARY || 'probe.md', out.join('\n') + '\n', { flag: 'a' }));
