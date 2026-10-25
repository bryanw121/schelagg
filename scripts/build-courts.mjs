// Writes public/data/courts.json from the live Skedda calendars (High Point, Crossover, Treehouse).
// Runs every ~15 minutes on GitHub Actions. If a venue fails, keeps its last good copy marked stale.
// The work is buildCourts in lib/pipeline.js (tested offline in test/pipeline.test.mjs).
import { loadEnv } from '../lib/paths.js';
import { buildCourts } from '../lib/pipeline.js';

loadEnv();

const { venues } = await buildCourts({ siteUrl: process.env.SITE_URL });
if (!venues.length) process.exitCode = 1; // nothing usable: fail the run so it shows up red
