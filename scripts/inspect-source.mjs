// Run one source's adapter for real and save everything it saw, raw, for working out what
// changed upstream: every HTTP response, every page's text, and what the adapter made of it.
//
//   node scripts/inspect-source.mjs <sourceId> [outDir]     (default: tmp/inspect/<sourceId>)
//
// Output (tmp/ is git-ignored; raw responses can contain people's names, so never commit them):
//   NN-<host><path>.txt   one per HTTP response or loaded page: a "# status url" line, then the body
//   result.json           { sessions, warnings, shape, contentHash } from the adapter, or { error }
//
// Used by the auto-fix job (.github/autofix-prompt.md) and handy locally. Fixtures for tests go
// through scripts/sanitize-fixtures.mjs instead.
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSources } from '../lib/registry.js';
import { repoPath } from '../lib/paths.js';
import { today } from '../lib/time.js';

const [id, outArg] = process.argv.slice(2);
const { sources } = loadSources();
const src = sources.find((s) => s.id === id);
if (!src) {
  console.error(`usage: node scripts/inspect-source.mjs <sourceId> [outDir]\nsources: ${sources.map((s) => s.id).join(', ')}`);
  process.exit(2);
}
const out = outArg ?? repoPath(`tmp/inspect/${id}`);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

let n = 0;
const slug = (url) => { const u = new URL(url); return `${u.hostname}${u.pathname}`.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 100); };
const save = async (url, status, body) => {
  const file = `${String(++n).padStart(2, '0')}-${slug(url)}.txt`;
  await writeFile(join(out, file), `# ${status} ${url}\n${body}`);
  console.log(`${status} ${url} -> ${file} (${body.length} chars)`);
};

/** fetch that records every response body before handing it back. */
const recordingFetch = async (url, init) => {
  const res = await fetch(url, init);
  const body = await res.text();
  await save(String(url), res.status, body);
  return new Response(body, { status: res.status, headers: res.headers });
};

/** Playwright browser whose pages record their text after each navigation. */
async function recordingBrowser() {
  const browser = await (await import('playwright')).chromium.launch();
  return {
    close: () => browser.close(),
    newPage: async () => {
      const page = await browser.newPage();
      const goto = page.goto.bind(page);
      page.goto = async (url, opts) => {
        const res = await goto(url, opts);
        await save(url, res?.status() ?? 0, await page.locator('body').innerText().catch((e) => `(no text: ${e.message})`));
        return res;
      };
      return page;
    },
  };
}

const browser = src.adapter.needsBrowser !== false ? await recordingBrowser() : null;
let result;
try {
  const r = await src.adapter.scrape({ browser, ref: today(new Date(), src.timezone), options: src.options, timezone: src.timezone, fetch: recordingFetch });
  result = { sessions: r.sessions, warnings: r.warnings ?? [], shape: r.shape, contentHash: r.contentHash };
  console.log(`ok: ${r.sessions.length} sessions, ${result.warnings.length} warnings`);
} catch (e) {
  result = { error: e.message };
  console.log(`adapter error: ${e.message}`);
} finally {
  await browser?.close();
}
await writeFile(join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`wrote ${out}`);
