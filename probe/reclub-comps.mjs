// Temporary probe 8 (branch only): save Vex's league and tournament pages as fixtures.
import { get } from '../lib/http.js';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('probe/vex', { recursive: true });
for (const p of ['tournaments-2', 'league', '6-feet-and-under', '6-feet-and-under-1', 'qilin', 'koi', 'dragon']) {
  const r = await get(`https://vexvolleyball.com/${p}`, { timeoutMs: 20000 });
  writeFileSync(`probe/vex/${p}.html`, r.text);
  console.log(p, r.status, r.text.length);
}
