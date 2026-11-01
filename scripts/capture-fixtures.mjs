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

// Austin Velocity (WordPress) + Acuity Scheduling
await grab('velocity-page', 'https://www.austinvelocity.com/rentals/adult-volleyball-2');
await grab('velocity-pricing-page', 'https://www.austinvelocity.com/rentals/fall-winter-adult-open-gym');
await grab('velocity-wp-pages', 'https://www.austinvelocity.com/wp-json/wp/v2/pages?slug=adult-volleyball-2,fall-winter-adult-open-gym&_fields=id,slug,modified,link,title,content');
await grab('velocity-robots', 'https://www.austinvelocity.com/robots.txt');
await grab('velocity-highpoint-search', 'https://www.austinvelocity.com/wp-json/wp/v2/search?search=open%20gym&per_page=20');
await grab('acuity-schedule-page', 'https://app.acuityscheduling.com/schedule.php?owner=19750684&appointmentType=99989782');
await grab('acuity-classes', 'https://app.acuityscheduling.com/api/scheduling/v1/availability/classes?owner=19750684&appointmentTypeIds[]=99989782&startDate=2026-11-01&endDate=2027-01-31&timezone=America%2FChicago&includeUnavailable=true');
await grab('acuity-dates', 'https://app.acuityscheduling.com/api/scheduling/v1/availability/dates?owner=19750684&appointmentTypeId=99989782&month=2026-11&timezone=America%2FChicago');
await grab('acuity-types', 'https://app.acuityscheduling.com/api/scheduling/v1/appointment-types?owner=19750684');
await grab('acuity-robots', 'https://app.acuityscheduling.com/robots.txt');
await grab('acuity-catalog', 'https://app.acuityscheduling.com/schedule.php?owner=19750684');

// Sweatpals (hosts with Austin volleyball)
await grab('sweatpals-robots', 'https://sweatpals.com/robots.txt');
await grab('sweatpals-host-atxbeach', 'https://sweatpals.com/host/ATXBeach');
await grab('sweatpals-host-letsvolleyatx', 'https://sweatpals.com/host/letsvolleyatx');
await grab('sweatpals-host-letsvolleyatx-schedule', 'https://sweatpals.com/host/letsvolleyatx/schedule');
await grab('sweatpals-event-friday-lunch', 'https://sweatpals.com/event/friday-lunch-open-play/2026-11-06');
await grab('sweatpals-event-sand-socials', 'https://sweatpals.com/event/austin-sand-socials-sunday-funday-open-play');
await grab('sweatpals-event-rise-volley', 'https://sweatpals.com/event/rise-volley-sunday-drills-open-play-morning-series-4d6003/2026-11-08');
await grab('sweatpals-discover-austin', 'https://sweatpals.com/s/austin/volleyball');

// ACES on Playbook, and its WordPress API
await grab('playbook-season-48903', 'https://acesintexas.playbookapi.com/programs/more_info/season/48903');
await grab('playbook-root', 'https://acesintexas.playbookapi.com/');
await grab('playbook-programs', 'https://acesintexas.playbookapi.com/programs/');
await grab('playbook-robots', 'https://acesintexas.playbookapi.com/robots.txt');
await grab('aces-wp-api', 'https://acesintexas.com/wp-json/wp/v2/pages?slug=wednesday-indoor-open-plays-volleyworld-pflugerville&_fields=id,slug,modified,content');

// Reclub club found by search but not by discovery
const club = await grab('reclub-club-capital-city-volleyball', 'https://reclub.co/clubs/@capital-city-volleyball');
for (const code of [...new Set(club.meetCodes || [])].slice(0, 3)) {
  await grab(`reclub-meet-${code.slice(3)}`, `https://reclub.co${code}`);
}
