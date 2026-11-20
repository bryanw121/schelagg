// Where the data is published: the first GitHub Pages address that answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstUp } from '../public/pages.js';

test('firstUp: the first base whose index answers; a renamed repository falls through to the other name', async () => {
  const asked = [];
  const web = (up) => async (url, init) => { asked.push([url, init.method]); if (!up.some((b) => url.startsWith(b))) throw new TypeError('Failed to fetch'); return { ok: true }; };
  const A = 'https://x.test/a/', B = 'https://x.test/b/';
  assert.equal(await firstUp([A, B], { fetch: web([A, B]) }), A);
  assert.deepEqual(asked, [[`${A}data/index.json`, 'HEAD']]);
  assert.equal(await firstUp([A, B], { fetch: web([B]) }), B);
  assert.equal(await firstUp([A, B], { fetch: async () => ({ ok: false }) }), A, 'none answers: the first, and its error shows as usual');
});
