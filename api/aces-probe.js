// TEMPORARY (#53): does ACES's site block Vercel's servers too? Fetches one ACES page and
// reports the status and a little of what came back. Remove once answered.
const URL_ = 'https://acesintexas.com/ptx-monday-indoor-open-plays-volleyworld-pflugerville/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export default async function handler(req, res) {
  let out;
  try {
    const r = await fetch(URL_, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(8000) });
    const text = await r.text();
    out = { status: r.status, server: r.headers.get('server'), bytes: text.length, title: text.match(/<title>([^<]*)/i)?.[1] ?? null, hasOpenPlay: /Open\s*Play\s*Time/i.test(text) };
  } catch (e) { out = { error: String(e?.message ?? e) }; }
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(out));
}
