#!/usr/bin/env node
// Build public/data/programs.json: leagues and tournaments open for sign-up (lib/programs/feed.js).
//
//   node scripts/programs.mjs            build now
//   node scripts/programs.mjs --if-due   build only if the last build is 11+ hours old (the
//                                        scrape workflow runs this every tick; it builds twice a day)
//   node scripts/programs.mjs --dry      print a summary, write nothing
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { get } from '../lib/http.js';
import { repoPath } from '../lib/paths.js';
import { loadRegions } from '../lib/regions.js';
import { buildFeed, isDue, runSources } from '../lib/programs/feed.js';

const args = new Set(process.argv.slice(2));
const OUT = repoPath('public/data/programs.json');
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const now = Date.now();

if (args.has('--if-due') && !isDue(previous, now)) {
  console.log(`programs.json was built at ${previous.generatedAt}; not due yet.`);
  process.exit(0);
}

const config = JSON.parse(readFileSync(repoPath('config/programs.json'), 'utf8'));
const regions = loadRegions().map((r) => r.info);
const results = await runSources(config, { get, now, regions });
const feed = buildFeed({ results, previous, now });

for (const s of feed.sources) console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.id}: ${s.count} programs${s.error ? ` (${s.error})` : ''}`);
console.log(`${feed.programs.length} programs in all.`);
if (args.has('--dry')) {
  for (const p of feed.programs) console.log(`  ${p.registration_deadline ?? '—'}  ${p.kind.padEnd(10)} ${p.sport.padEnd(10)} ${p.title} · ${p.org}`);
  process.exit(0);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(feed, null, 1)}\n`);
// A failed source goes in the region-independent failure report the workflow turns into an issue.
const failed = feed.sources.filter((s) => !s.ok);
mkdirSync(repoPath('scrape-failures'), { recursive: true });
if (failed.length) {
  writeFileSync(repoPath('scrape-failures/programs.md'), `Leagues and tournaments (programs.json): ${failed.length} source(s) failed; their last good rows are kept.\n\n${failed.map((s) => `- **${s.id}**: ${s.error}`).join('\n')}\n`);
} else {
  writeFileSync(repoPath('scrape-failures/programs.md'), '');
}
