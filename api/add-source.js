// POST /api/add-source { input, target, region } -> checks, right then, whether Schelagg can read
// what someone named (lib/add-source.js) and answers { status: 'have' | 'ok' | 'no', title, detail, found }.
//
// When it can ('ok'), the source is saved by opening a GitHub issue labelled "add-source" with
// GITHUB_FEEDBACK_TOKEN (the same token as api/feedback.js: Issues read and write on this
// repository). The "Add a source" workflow acts only on such issues opened by the repository's
// owner (which is who that token is), runs the same check again on GitHub's side, and commits the
// config change. Without the token nothing can be saved: the answer says so (saved: false).
// A source that can't be read yet but looks worth a reader is filed as a "source-request" issue.
import { get } from '../lib/http.js';
import { checkSource, MAX_INPUT } from '../lib/add-source.js';
import { loadAddConfig } from '../lib/add-source-config.js';

const REPO = 'bryanw121/schelagg';
const PER_MINUTE = 6;
const readBody = async (req) => {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 8000) throw new Error('too long'); }
  return JSON.parse(raw || '{}');
};

export function createHandler({ token = process.env.GITHUB_FEEDBACK_TOKEN, fetch = globalThis.fetch, config, check = checkSource, now = Date.now, log = console.warn } = {}) {
  let recent = [];
  let cfg = config ?? null;
  const issue = async (title, body, label) => {
    const r = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'skelly-add-source' },
      body: JSON.stringify({ title, body, labels: [label] }),
    });
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  };
  return async function handler(req, res) {
    const send = (status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST') { res.setHeader('allow', 'POST'); return send(405, { error: 'POST only' }); }
    let body;
    try { body = await readBody(req); } catch { return send(400, { error: 'Send JSON: { "input": "...", "target": "events", "region": "austin" }' }); }
    const input = typeof body?.input === 'string' ? body.input.trim().slice(0, MAX_INPUT + 1) : '';
    const target = typeof body?.target === 'string' ? body.target : '';
    const region = typeof body?.region === 'string' ? body.region : '';
    if (body?.website) return send(200, { status: 'no', title: "Couldn't add it.", detail: 'Try again later.', found: 0 });
    const t = now();
    recent = recent.filter((x) => t - x < 60e3);
    if (recent.length >= PER_MINUTE) return send(429, { error: 'Too many at once. Try again in a minute.' });
    recent.push(t);
    let result;
    try { result = await check({ input, target, region }, { get: (url, o) => get(url, { ...o, fetch }), config: (cfg ??= loadAddConfig()) }); }
    catch (e) { log(`api/add-source: ${String(e?.message ?? e).slice(0, 160)}`); return send(502, { error: "Couldn't finish checking it just now. Try again in a minute." }); }
    const { plan, wanted, ...answer } = result;
    if (result.status === 'ok') {
      answer.saved = false;
      if (token) {
        try {
          // The workflow reads only this JSON line, checks it all again, and derives the change itself.
          await issue(`Add source: ${result.label}`.slice(0, 120), `Checked from the site: ${result.title}\n\n\`\`\`json\n${JSON.stringify({ input, target, region })}\n\`\`\``, 'add-source');
          answer.saved = true;
        } catch (e) { log(`api/add-source: ${e.message}`); }
      }
      if (!answer.saved) { answer.title = `It checks out: ${result.found} found.`; answer.detail = "But it couldn't be saved from here just now. Send it as feedback and it will be added."; }
    } else if (wanted && token) {
      try { await issue(`Source request: ${input}`.slice(0, 120), `Someone asked for this source and no reader fits yet.\n\n- For: ${target} in ${region}\n- ${result.detail}\n\n\`\`\`\n${input}\n\`\`\``, 'source-request'); } catch (e) { log(`api/add-source: ${e.message}`); }
    }
    return send(200, answer);
  };
}

export default createHandler();
