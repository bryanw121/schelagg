// Temporary probe 3 (branch only): how the site lists a club's competitions (API paths in the bundles), api robots.
import { get } from '../lib/http.js';
import { writeFileSync } from 'node:fs';
const out = []; const say = (s) => { out.push(s); console.log(s); };
const page = await get('https://reclub.co/clubs/@vex_volleyball', { timeoutMs: 20000 });
const entry = page.text.match(/\/_nuxt\/entry\.[^"]+\.js/)?.[0];
const e = await get(`https://reclub.co${entry}`, { timeoutMs: 20000 });
const chunks = [...new Set([...e.text.matchAll(/\.\/([A-Za-z0-9_.-]+\.js)/g)].map((m) => m[1]))];
say(`## ${chunks.length} chunks; scanning those named like club/compet`);
const hits = new Set();
for (const c of chunks.filter((c) => /club|compet|activit|_id_|slug|index/i.test(c)).slice(0, 60)) {
  const r = await get(`https://reclub.co/_nuxt/${c}`, { timeoutMs: 20000 }).catch(() => null);
  if (!r?.ok) continue;
  for (const m of r.text.matchAll(/[`"']([^`"'\s]{0,60}\/(?:competitions?|activities|meets)[^`"'\s]{0,60})[`"']/g)) hits.add(`${c}: ${m[1]}`);
}
for (const h of [...hits].slice(0, 80)) say(`- ${h}`);
say('\n## api.reclub.co robots');
const rb = await get('https://api.reclub.co/robots.txt', { timeoutMs: 15000 }).catch((err) => ({ status: err.message, text: '' }));
say('HTTP ' + rb.status + '\n```\n' + rb.text.slice(0, 600) + '\n```');
writeFileSync(process.env.GITHUB_STEP_SUMMARY || 'probe.md', out.join('\n') + '\n', { flag: 'a' });
