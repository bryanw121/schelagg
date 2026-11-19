#!/usr/bin/env node
// Which venues do we know only second-hand? (lib/coverage.js) Reads each region's published
// schedule (public/data/regions/<id>/schedule.json) and its sources.json, and writes
// public/data/coverage.json and coverage.md (published with the feeds). The scrape workflow runs it after every refresh.
//
//   node scripts/coverage.mjs           write the report
//   node scripts/coverage.mjs --print   print the Markdown, write nothing
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { repoPath } from '../lib/paths.js';
import { loadRegions } from '../lib/regions.js';
import { coverageMarkdown, venueCoverage } from '../lib/coverage.js';

const regions = [];
for (const r of loadRegions()) {
  const file = repoPath(`public/data/regions/${r.info.id}/schedule.json`);
  if (!existsSync(file)) continue;
  const sources = JSON.parse(readFileSync(repoPath(`config/regions/${r.info.id}/sources.json`), 'utf8'));
  regions.push({ id: r.info.id, name: r.info.name, rows: venueCoverage(JSON.parse(readFileSync(file, 'utf8')), Array.isArray(sources) ? sources : sources.sources) });
}
const md = coverageMarkdown(regions);
if (process.argv.includes('--print')) { process.stdout.write(md); process.exit(0); }
mkdirSync(repoPath('public/data'), { recursive: true });
writeFileSync(repoPath('public/data/coverage.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), regions }, null, 1)}\n`);
writeFileSync(repoPath('public/data/coverage.md'), md);
console.log(regions.map((r) => `${r.id}: ${r.rows.filter((x) => x.lead).length} second-hand venue(s) of ${r.rows.length}`).join('; '));
