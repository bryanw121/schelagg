// Runs on the home computer (.github/workflows/scrape-home.yml): scrape the sources marked
// "runsAt": "home" with their real adapters and write data/offsite/<id>.json. The workflow
// commits those files to the data branch; the main scrape reads them (lib/offsite.js).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadEnv } from '../lib/paths.js';
import { loadSources } from '../lib/registry.js';
import { HOME, offsiteFile } from '../lib/offsite.js';
import { today } from '../lib/time.js';

loadEnv();
const home = loadSources().sources.filter((s) => s.runsAt === HOME);
if (!home.length) { console.log('No sources run at home.'); process.exit(0); }

const browser = home.some((s) => s.adapter.needsBrowser !== false)
  ? await (await import('playwright')).chromium.launch() : null;
try {
  for (const s of home) {
    const checkedAt = new Date().toISOString();
    let out;
    try {
      const r = await s.adapter.scrape({ browser, ref: today(new Date(), s.timezone), options: s.options, timezone: s.timezone, fetch });
      out = { id: s.id, checkedAt, ok: true, sessions: r.sessions, warnings: r.warnings, shape: r.shape, contentHash: r.contentHash };
      console.log(`ok    ${s.id}: ${r.sessions.length} sessions`);
    } catch (e) {
      out = { id: s.id, checkedAt, ok: false, error: e.message };
      console.log(`FAIL  ${s.id}: ${e.message}`);
    }
    mkdirSync(dirname(offsiteFile(s.id)), { recursive: true });
    writeFileSync(offsiteFile(s.id), JSON.stringify(out, null, 2) + '\n');
  }
} finally {
  await browser?.close();
}
