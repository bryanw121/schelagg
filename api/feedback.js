// POST /api/feedback { message, page? } -> saves one piece of feedback from the site's footer as a
// GitHub issue (label "feedback"). Needs GITHUB_FEEDBACK_TOKEN (fine-grained, Issues: read and
// write on the repository named by FEEDBACK_REPO, default this one); without it the answer is
// 501 and the page offers a link that opens the same text as a new issue on GitHub instead.
// Nothing about the sender is kept: no address, no account, no IP.
export const MAX_FEEDBACK = 2000;
const PER_MINUTE = 5; // per running instance: a brake on a stuck button or a loop, not on abuse
const readBody = async (req) => {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 16000) throw new Error('too long'); }
  return JSON.parse(raw || '{}');
};

export function createHandler({ token = process.env.GITHUB_FEEDBACK_TOKEN, repo = process.env.FEEDBACK_REPO || 'bryanw121/schelagg', fetch = globalThis.fetch, now = Date.now, log = console.warn } = {}) {
  let recent = [];
  return async function handler(req, res) {
    const send = (status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST') { res.setHeader('allow', 'POST'); return send(405, { error: 'POST only' }); }
    let body;
    try { body = await readBody(req); } catch { return send(400, { error: 'Send JSON: { "message": "..." }' }); }
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!message) return send(400, { error: 'Write something first.' });
    if (message.length > MAX_FEEDBACK) return send(400, { error: `Keep it under ${MAX_FEEDBACK} characters.` });
    if (body.website) return send(200, { ok: true }); // a field people never see: only a script fills it in
    if (!token) return send(501, { error: 'not-configured' });
    const t = now();
    recent = recent.filter((x) => t - x < 60e3);
    if (recent.length >= PER_MINUTE) return send(429, { error: 'Too many at once. Try again in a minute.' });
    recent.push(t);
    // Only a link to this site is kept as "where they were"; anything else typed into `page` is dropped.
    const page = typeof body.page === 'string' && /^https:\/\/([a-z0-9-]+\.)*(skellyevents\.com|schelagg\.vercel\.app|bryanw121\.github\.io)\//.test(body.page) ? body.page.slice(0, 500) : '';
    const title = `Feedback: ${message.replace(/\s+/g, ' ').slice(0, 60)}${message.length > 60 ? '…' : ''}`;
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'skelly-feedback' },
        body: JSON.stringify({ title, body: `${message}${page ? `\n\n---\nSent from ${page}` : ''}`, labels: ['feedback'] }),
      });
      if (!r.ok) { log(`api/feedback: GitHub answered ${r.status}`); return send(502, { error: 'Could not save it just now.' }); }
      return send(200, { ok: true });
    } catch (e) {
      log(`api/feedback: ${String(e?.message ?? e).slice(0, 120)}`);
      return send(502, { error: 'Could not save it just now.' });
    }
  };
}

export default createHandler();
