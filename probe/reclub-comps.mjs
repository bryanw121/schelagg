// Temporary probe 2 (branch only): club competition counts, the API the app uses for competitions, community pages.
import { get } from '../lib/http.js';
import { nuxtData } from '../lib/devalue.js';
import { writeFileSync } from 'node:fs';
const out = [];
const say = (s) => { out.push(s); console.log(s); };
const clubs = ['vex_volleyball', 'austin-lawn-club', 'ync-volleyball-dallas-texas-usa-95', 'north-houston', 'cinco-ranch-volleyball-club'];
let firstHtml = '';
say('## Club counts and ids');
for (const slug of clubs) {
  const r = await get(`https://reclub.co/clubs/@${slug}`, { timeoutMs: 20000 });
  if (!firstHtml) firstHtml = r.text;
  const d = nuxtData(r.text)?.data?.[`club-@${slug}`]?.club ?? {};
  say(`- ${slug}: id ${d.id}, communityId ${d.communityId ?? d.community?.id}, counts ${JSON.stringify(d.counts)}`);
}
say('\n## Runtime config (API base)');
const cfg = firstHtml.match(/window\.__NUXT__\.config=([^<]{0,1500})/)?.[1] ?? firstHtml.match(/__NUXT__\.config\s*=\s*([^<]{0,1500})/)?.[1];
say('```\n' + (cfg ?? 'no __NUXT__.config found').slice(0, 1500) + '\n```');
say('\n## JS bundles: competition endpoints');
const scripts = [...new Set([...firstHtml.matchAll(/(?:src|href)="(\/_nuxt\/[^"]+\.js)"/g)].map((m) => m[1]))];
say(`${scripts.length} scripts on the club page`);
const hits = new Set();
for (const s of scripts.slice(0, 80)) {
  const r = await get(`https://reclub.co${s}`, { timeoutMs: 20000 }).catch(() => null);
  if (!r?.ok) continue;
  for (const m of r.text.matchAll(/["'`]([^"'`\s]{0,80}compet[^"'`\s]{0,80})["'`]/gi)) if (/\//.test(m[1])) hits.add(`${s.split('/').pop()}: ${m[1]}`);
  for (const m of r.text.matchAll(/https?:\/\/[a-z0-9.-]*reclub[a-z0-9.-]*[^"'`\s]{0,60}/gi)) hits.add(`${s.split('/').pop()}: ${m[0]}`);
}
for (const h of [...hits].slice(0, 80)) say(`- ${h}`);
say('\n## Community pages');
const sm = await get('https://reclub.co/__sitemap__/en-US.xml', { timeoutMs: 30000 });
const comms = [...sm.text.matchAll(/<loc>(https:\/\/reclub\.co\/communities\/[^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => /austin|dallas|houston|san-antonio|fort-worth|plano|texas|-tx-/i.test(u));
say(`${comms.length} Texas-looking communities: ${comms.slice(0, 20).join(' ')}`);
for (const u of comms.slice(0, 8)) {
  const r = await get(u, { timeoutMs: 20000 }).catch((e) => ({ status: e.message, text: '' }));
  const compsLinked = new Set([...r.text.matchAll(/\/c\/([0-9a-f-]{36})/g)].map((m) => m[1]));
  let keys = [];
  try { const data = nuxtData(r.text)?.data ?? {}; keys = Object.keys(data).slice(0, 10); const k = Object.keys(data).find((x) => /^community/.test(x)); if (k) keys.push(JSON.stringify(Object.keys(data[k] ?? {})).slice(0, 300), JSON.stringify(data[k]?.community?.counts ?? data[k]?.counts ?? null)); } catch {}
  say(`- ${u}: HTTP ${r.status}, competitions linked ${compsLinked.size} ${[...compsLinked].slice(0, 5).join(',')}, data ${JSON.stringify(keys)}`);
}
writeFileSync(process.env.GITHUB_STEP_SUMMARY || 'probe.md', out.join('\n') + '\n', { flag: 'a' });
