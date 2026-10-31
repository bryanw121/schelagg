// Sources scraped off GitHub (#53). Some sites (ACES, behind Cloudflare) refuse every cloud
// provider's servers, GitHub's and Vercel's included. A source with "runsAt": "home" in its
// region's sources.json is scraped by .github/workflows/scrape-home.yml on a self-hosted runner
// (a home computer), which writes data/offsite/<id>.json to the data branch. The main scrape
// doesn't fetch that source; it reads the file through offsiteAdapter, so validation,
// keep-last-good, health checks and failure issues all work as for any other source.
import { readFileSync } from 'node:fs';
import { repoPath } from './paths.js';
import { cadenceMs } from './registry.js';

export const HOME = 'home';
export const offsiteFile = (id) => repoPath(`data/offsite/${id}.json`);

/** How old the home runner's result may get before the source counts as failed: 3 cadences, at least 3h. */
export const maxAgeMs = (cadence) => Math.max(3 * cadenceMs(cadence), 3 * 3600_000);

/** An adapter that serves the home runner's last result for source `s`. */
export function offsiteAdapter(s, { read = (id) => JSON.parse(readFileSync(offsiteFile(id), 'utf8')), now = () => new Date() } = {}) {
  return {
    id: `offsite:${s.adapter.id ?? s.id}`,
    needsBrowser: false,
    reads: s.adapter.reads,
    async scrape() {
      let r;
      try { r = read(s.id); } catch { throw new Error('the home runner has not reported yet (data/offsite is empty)'); }
      const age = now() - Date.parse(r.checkedAt);
      if (!(age <= maxAgeMs(s.cadence))) throw new Error(`the home runner last reported ${r.checkedAt}; is the home computer off?`);
      if (!r.ok) throw new Error(`home runner: ${r.error}`);
      return { sessions: r.sessions, warnings: r.warnings, shape: r.shape, contentHash: r.contentHash };
    },
  };
}

/** On GitHub: swap each home source's adapter for the reader. Elsewhere sources pass through. */
export const withOffsite = (sources, opts) =>
  sources.map((s) => (s.runsAt === HOME ? { ...s, adapter: offsiteAdapter(s, opts) } : s));
