// TEMPORARY probe (branch probe/austin-sources, not for merge): raw responses from candidate
// Austin volleyball sources, so adapters can be written against real data. Personal data is
// pruned (JSON keys about people, emails, phones) before anything is written.
import { mkdir, writeFile } from 'node:fs/promises';
import { repoPath } from '../lib/paths.js';
import { scrubText } from './sanitize-fixtures.mjs';

const OUT = repoPath('test/fixtures/sources/probe');
const UA = 'Mozilla/5.0 (compatible; Schelagg/0.4; +https://github.com/bryanw121/schelagg)';
await mkdir(OUT, { recursive: true });
const PEOPLE = /attendee|participant|user|member|guest|rsvp|profile|avatar|photo|email|phone|token|cookie|follower|owner(?!Id)|customer|buyer|ticketHolder|reviews?$/i;
const prune = (v, depth = 0) => {
  if (Array.isArray(v)) return v.slice(0, 60).map((x) => prune(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !PEOPLE.test(k)).map(([k, x]) => [k, prune(x, depth + 1)]));
  return typeof v === 'string' ? scrubText(v).slice(0, 2000) : v;
};
const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|h\d|li|tr|section)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#8211;|&ndash;/g, '–').replace(/&#8212;/g, '—').replace(/&#8226;|&bull;/g, '•').replace(/&#8217;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

async function grab(name, url, init = {}) {
  let out;
  try {
    const res = await fetch(url, { ...init, headers: { 'user-agent': UA, accept: 'application/json, text/html;q=0.9, */*;q=0.5', ...(init.headers || {}) }, signal: AbortSignal.timeout(30000) });
    const body = await res.text();
    const type = res.headers.get('content-type') || '';
    out = { url: String(url), status: res.status, type, length: body.length, server: res.headers.get('server'), cfRay: !!res.headers.get('cf-ray') };
    if (/json/.test(type) || /^\s*[[{]/.test(body)) { try { out.json = prune(JSON.parse(body)); } catch { out.raw = scrubText(body).slice(0, 20000); } }
    else if (/html/.test(type) || /<html/i.test(body)) {
      out.title = body.match(/<title[^>]*>([^<]*)/i)?.[1];
      out.text = scrubText(text(body)).slice(0, 30000);
      out.jsonLd = [...body.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => { try { return prune(JSON.parse(m[1])); } catch { return null; } });
      const next = body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
      if (next) { try { out.nextData = prune(JSON.parse(next)); } catch {} }
      out.nextFlight = [...body.matchAll(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g)].map((m) => m[1]).join('').length || undefined;
      out.apiUrls = [...new Set(body.match(/https?:\/\/[A-Za-z0-9.-]+\/(?:api|v\d|graphql|wp-json)[^"'\s<>\\)]*/g) || [])].slice(0, 60);
      out.scripts = [...new Set(body.match(/<script[^>]+src="([^"]+)"/g) || [])].slice(0, 30);
      out.relLinks = [...new Set(body.match(/href="(\/[^"]{1,120})"/g) || [])].slice(0, 200);
      out.quotedPaths = [...new Set(body.match(/['"](\/(?:programs|api|communities|sports|clubs|explore)[^'"\s]{0,100})['"]/g) || [])].slice(0, 200);
      out.meetCodes = [...new Set(body.match(/\/m\/[A-Za-z0-9]{5,8}\b/g) || [])].slice(0, 20);
      out.iframes = [...new Set(body.match(/<iframe[^>]+src="([^"]+)"/g) || [])];
      out.links = [...new Set(body.match(/href="(https?:\/\/[^"]+)"/g) || [])].filter((l) => /acuity|sweatpals|reclub|playbook|ics|calendar|schedule|register|book/i.test(l)).slice(0, 80);
    } else out.raw = scrubText(body).slice(0, 20000);
  } catch (e) { out = { url: String(url), error: e.message }; }
  await writeFile(`${OUT}/${name}.json`, JSON.stringify(out, null, 1));
  console.log(`${out.status ?? 'ERR'} ${name} ${out.length ?? out.error}`);
  await new Promise((r) => setTimeout(r, 400));
  return out;
}



const us = await grab('reclub-communities-us', 'https://reclub.co/communities/us');
const next = (us.relLinks || []).map((l) => l.slice(6, -1)).filter((l) => /^\/communities\/us\/./.test(l));
console.log('us links', next.length, next.slice(0, 80).join(' '));
for (const l of next.filter((l) => /tx|texas|austin/i.test(l)).slice(0, 4)) {
  const r = await grab(`reclub${l.replace(/\//g, '-')}`, `https://reclub.co${l}`);
  const deeper = (r.relLinks || []).map((x) => x.slice(6, -1)).filter((x) => /austin/i.test(x));
  for (const d of deeper.slice(0, 3)) await grab(`reclub${d.replace(/\//g, '-')}`, `https://reclub.co${d}`);
}
try {
  const res = await fetch('https://reclub.co/__sitemap__/en-US.xml', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) });
  const body = await res.text();
  const locs = body.match(/<loc>[^<]+<\/loc>/g) || [];
  const kinds = {};
  for (const l of locs) { const k = (l.match(/reclub\.co\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?([^/<]+)/) || [])[1] || '?'; kinds[k] = (kinds[k] || 0) + 1; }
  const austin = locs.filter((l) => /austin|atx|texas|tx\b/i.test(l)).slice(0, 100);
  await writeFile(`${OUT}/reclub-sitemap-en.json`, JSON.stringify({ status: res.status, length: body.length, count: locs.length, kinds, sample: locs.slice(0, 40), austin }, null, 1));
  console.log('sitemap', res.status, locs.length);
} catch (e) { console.log('sitemap ERR', e.message); }
