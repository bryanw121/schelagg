// Where the published data and map files are. The site's own addresses (skellyevents.com,
// *.vercel.app) serve only the pages; data/ and maps/ are on GitHub Pages, whose address follows
// the repository's name. Renaming the repository moves it with no redirect (that took the site
// down on Nov 19, 2026), so both names are tried and the one that answers is remembered for the visit.
const BASES = ['https://bryanw121.github.io/schelagg/', 'https://bryanw121.github.io/skelly/'];
const here = typeof location !== 'undefined' ? location.hostname : 'localhost';
export const OFF_PAGES = !/(^|\.)github\.io$|^localhost$|^127\.0\.0\.1$/.test(here);

/** The first base whose data/index.json answers; the first one when none does (its error is then shown as usual). */
export async function firstUp(bases, { fetch: f = globalThis.fetch, timeoutMs = 6000 } = {}) {
  for (const base of bases) {
    try { const r = await f(`${base}data/index.json`, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) }); if (r.ok) return base; } catch { /* try the next */ }
  }
  return bases[0];
}

/** '' on GitHub Pages or a local copy (files sit next to the page); otherwise the Pages address that works. */
export async function pagesBase() {
  if (!OFF_PAGES) return '';
  try { const saved = sessionStorage.getItem('skelly.pages'); if (BASES.includes(saved)) return saved; } catch { /* private mode */ }
  const base = await firstUp(BASES);
  try { sessionStorage.setItem('skelly.pages', base); } catch { /* fine */ }
  return base;
}
