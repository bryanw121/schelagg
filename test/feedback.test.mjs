// POST /api/feedback: what it accepts, what it saves, and what it says when it can't.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, MAX_FEEDBACK } from '../api/feedback.js';

const call = async (handler, { method = 'POST', body } = {}) => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(text) { this.text = text; } };
  await handler({ method, body }, res);
  return { status: res.statusCode, json: JSON.parse(res.text) };
};
const github = (status = 201) => { const calls = []; const f = async (url, init) => { calls.push({ url, init, sent: JSON.parse(init.body) }); return new Response('{}', { status }); }; f.calls = calls; return f; };

test('feedback: a message becomes one labelled issue; nothing about the sender goes with it', async () => {
  const fetch = github();
  const h = createHandler({ token: 't0ken', repo: 'someone/somewhere', fetch });
  const r = await call(h, { body: { message: '  The map is slow on my phone.  ', page: 'https://www.skellyevents.com/?view=events&layout=map' } });
  assert.deepEqual(r, { status: 200, json: { ok: true } });
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, 'https://api.github.com/repos/someone/somewhere/issues');
  assert.equal(fetch.calls[0].init.headers.authorization, 'Bearer t0ken');
  assert.deepEqual(fetch.calls[0].sent, { title: 'Feedback: The map is slow on my phone.', body: 'The map is slow on my phone.\n\n---\nSent from https://www.skellyevents.com/?view=events&layout=map', labels: ['feedback'] });
  // A "page" that isn't this site is dropped, and a JSON string body works too.
  await call(h, { body: JSON.stringify({ message: 'x'.repeat(80), page: 'https://evil.test/' }) });
  assert.equal(fetch.calls[1].sent.body, 'x'.repeat(80));
  assert.equal(fetch.calls[1].sent.title, `Feedback: ${'x'.repeat(60)}…`);
});

test('feedback: refusals, the hidden field, no token, GitHub down, and the per-minute brake', async () => {
  const fetch = github();
  const h = createHandler({ token: 't', fetch });
  assert.equal((await call(h, { method: 'GET' })).status, 405);
  assert.equal((await call(h, { body: { message: '   ' } })).status, 400);
  assert.equal((await call(h, { body: { message: 'x'.repeat(MAX_FEEDBACK + 1) } })).status, 400);
  assert.equal((await call(h, { body: '{not json' })).status, 400);
  assert.deepEqual(await call(h, { body: { message: 'buy pills', website: 'http://spam' } }), { status: 200, json: { ok: true } });
  assert.equal(fetch.calls.length, 0, 'none of those reached GitHub');
  assert.deepEqual(await call(createHandler({ token: '', fetch }), { body: { message: 'hi' } }), { status: 501, json: { error: 'not-configured' } });
  assert.equal((await call(createHandler({ token: 't', fetch: github(403), log() {} }), { body: { message: 'hi' } })).status, 502);
  let t = 0;
  const braked = createHandler({ token: 't', fetch, now: () => t });
  for (let i = 0; i < 5; i++) assert.equal((await call(braked, { body: { message: 'hi' } })).status, 200);
  assert.equal((await call(braked, { body: { message: 'hi' } })).status, 429);
  t = 61e3;
  assert.equal((await call(braked, { body: { message: 'hi' } })).status, 200);
});
