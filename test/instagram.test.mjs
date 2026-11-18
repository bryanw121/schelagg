// Instagram organizers through Meta's official API (lib/instagram.js) and their saved profile
// pictures (lib/avatars.js). The API answers here are hand-written in the documented shape
// (Business Discovery: username, name, profile_picture_url, media.data[]); no real account's posts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captionDates, captionTimes, captionVenue, discoveryUrl, handleOf, postToEvent, readInstagram } from '../lib/instagram.js';
import { saveAvatars, stampAvatars } from '../lib/avatars.js';
import { avatarPath } from '../public/events-ui.js';

const TODAY = '2026-11-18';
const CAPTION = 'Holiday Night Market is back! ✨\nJoin us Sat, Dec 5 from 5-9pm for 40+ local makers and live music.\n📍 Example Hall, 100 Main St\n#austin #market';
const post = (o = {}) => ({ caption: CAPTION, permalink: 'https://www.instagram.com/p/abc/', timestamp: '2026-11-18T15:00:00+0000', media_type: 'IMAGE', ...o });

test('the request: numeric user id, a real username, fields only; the token is never in the URL', () => {
  const u = discoveryUrl('17841400000000000', 'moonchi.mochi');
  assert.match(u, /^https:\/\/graph\.facebook\.com\/v\d+\.\d\/17841400000000000\?fields=business_discovery\.username\(moonchi\.mochi\)/);
  assert.ok(!/access_token/.test(u));
  assert.ok(!/media/.test(discoveryUrl('1', 'x', { posts: false })));
  assert.throws(() => discoveryUrl('me', 'x'));
  assert.throws(() => discoveryUrl('1', 'bad handle){id}'));
  assert.equal(handleOf('Instagram @VistaBrewing'), 'vistabrewing');
  assert.equal(handleOf('Instagram'), null);
  assert.equal(handleOf('Visit Austin'), null);
});

test('captionDates: the first date on or after the post; ranges; never a bare weekday', () => {
  assert.deepEqual(captionDates(CAPTION, TODAY), { startDate: '2026-12-05' });
  assert.deepEqual(captionDates('Open 11/27-12/20, tickets $12.50', TODAY), { startDate: '2026-11-27', endDate: '2026-12-20' });
  assert.deepEqual(captionDates('Nov 28 – Dec 20 at the taproom', TODAY), { startDate: '2026-11-28', endDate: '2026-12-20' });
  assert.deepEqual(captionDates('November 21-23, all weekend', TODAY), { startDate: '2026-11-21', endDate: '2026-11-23' });
  assert.deepEqual(captionDates('NYE pop-up Jan 2', '2026-12-20'), { startDate: '2027-01-02' }, 'rolls into next year');
  assert.equal(captionDates('see you this Saturday', TODAY), null);
  assert.equal(captionDates('our best market yet was Oct 3', TODAY), null, 'a date 10+ months off is not an upcoming event');
  assert.equal(captionDates('1/2 off all tees, 24/7', TODAY), null);
});

test('captionTimes and captionVenue', () => {
  assert.deepEqual(captionTimes('from 5-9pm'), { startTime: '17:00', endTime: '21:00' });
  assert.deepEqual(captionTimes('11am – 3:30 PM'), { startTime: '11:00', endTime: '15:30' });
  assert.deepEqual(captionTimes('doors at 7pm'), { startTime: '19:00' });
  assert.deepEqual(captionTimes('no time here'), {});
  assert.equal(captionVenue(CAPTION), 'Example Hall, 100 Main St');
  assert.equal(captionVenue('Pop-up this Sat at The Little Shop on 34th! come by'), 'The Little Shop on 34th');
  assert.equal(captionVenue('come hang with us'), null);
});

test('postToEvent: a clear caption becomes an event that links to the post; unclear ones are skipped', () => {
  const ev = postToEvent(post(), { handle: 'examplemarket', name: 'Example Market' }, { today: TODAY });
  assert.deepEqual([ev.title, ev.venue, ev.city, ev.startDate, ev.startTime, ev.endTime, ev.kind], ['Holiday Night Market is back', 'Example Hall, 100 Main St', 'Austin', '2026-12-05', '17:00', '21:00', 'seasonal']);
  assert.deepEqual([ev.sourceUrl, ev.source, ev.account], ['https://www.instagram.com/p/abc/', 'Instagram @examplemarket', 'examplemarket']);
  assert.equal(ev.description, 'Posted by Example Market on Instagram. See the post for details.', 'our own line, never the caption');
  assert.ok(!JSON.stringify(ev).includes('40+ local makers'));
  const at = (o) => postToEvent(post(o), { handle: 'x' }, { today: TODAY });
  assert.equal(at({ caption: 'New tees just dropped! Dec 5' }), null, 'not an event');
  assert.equal(at({ caption: 'Holiday market soon, stay tuned\n📍 Example Hall' }), null, 'no date');
  assert.equal(at({ caption: 'Holiday market Dec 5, 5-9pm' }), null, 'no place');
  assert.equal(postToEvent(post({ caption: 'Holiday market Dec 5, 5-9pm' }), { handle: 'x', venue: 'Our Taproom' }, { today: TODAY }).venue, 'Our Taproom', 'the account\'s own venue');
  assert.equal(at({ timestamp: '2026-10-01T00:00:00+0000', caption: 'Fall market Oct 10\n📍 Example Hall' }), null, 'already over');
  assert.equal(at({ permalink: 'https://evil.test/p/abc/' }), null);
});

const answer = (handle, media) => JSON.stringify({ business_discovery: { username: handle, name: `${handle} name`, profile_picture_url: `https://cdn.example.test/${handle}.jpg`, ...(media ? { media: { data: media } } : {}) }, id: '1' });

test('readInstagram: posts from configured accounts, pictures for credited ones, unreadable accounts skipped', async () => {
  const seen = [];
  const get = async (url, opts) => {
    seen.push([url, opts.headers.authorization]);
    const h = decodeURIComponent(url).match(/username\(([^)]+)\)/)[1];
    if (h === 'personal') return { ok: false, status: 400, text: JSON.stringify({ error: { code: 110, type: 'OAuthException' } }) };
    return { ok: true, status: 200, text: answer(h, h === 'examplemarket' ? [post(), post({ permalink: 'https://www.instagram.com/p/def/', caption: 'thanks for coming out!' })] : null) };
  };
  const r = await readInstagram({ region: 'austin', city: 'Austin', accounts: [{ handle: 'examplemarket' }, { handle: 'personal' }] }, { get, today: TODAY, igUserId: '123', token: 'T', extraHandles: ['credited', 'examplemarket'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.events.map((e) => e.title), ['Holiday Night Market is back']);
  assert.deepEqual(Object.keys(r.profiles), ['examplemarket', 'credited']);
  assert.deepEqual(r.skipped, ['personal']);
  assert.equal(seen.length, 3, 'a configured account isn\'t looked up twice');
  assert.ok(seen.every(([u, auth]) => auth === 'Bearer T' && !u.includes('T&') && !/access_token/.test(u)));
  assert.ok(!/media/.test(decodeURIComponent(seen[2][0])), 'credited accounts: picture only');
});

test('readInstagram: an expired token fails the run with a plain reason; no account readable is a failure', async () => {
  const expired = async () => ({ ok: false, status: 400, text: JSON.stringify({ error: { code: 190, type: 'OAuthException', message: 'secret detail' } }) });
  const r = await readInstagram({ accounts: [{ handle: 'a' }, { handle: 'b' }] }, { get: expired, today: TODAY, igUserId: '1', token: 'T' });
  assert.deepEqual([r.ok, r.error, r.events.length], [false, 'Instagram API: OAuthException 190 (the token is invalid or expired)', 0]);
  const none = await readInstagram({ accounts: [{ handle: 'a' }] }, { get: async () => ({ ok: false, status: 400, text: '{"error":{"code":110}}' }), today: TODAY, igUserId: '1', token: 'T' });
  assert.equal(none.ok, false);
});

test('avatars: a small copy per account, an index, and the path stamped on credited events', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'avatars-'));
  const img = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const fetch = async (url) => (url.includes('big') ? { ok: true, headers: new Map([['content-type', 'image/jpeg']]), arrayBuffer: async () => new ArrayBuffer(500 * 1024) }
    : url.includes('html') ? { ok: true, headers: new Map([['content-type', 'text/html']]), arrayBuffer: async () => img }
      : { ok: true, headers: new Map([['content-type', 'image/jpeg; charset=binary']]), arrayBuffer: async () => img });
  const n = await saveAvatars({ examplemarket: { name: 'Example Market', picture: 'https://cdn.example.test/a.jpg' }, toobig: { picture: 'https://cdn.example.test/big.jpg' }, notimage: { picture: 'https://cdn.example.test/html' }, '../evil': { picture: 'https://cdn.example.test/a.jpg' }, plain: { picture: 'http://cdn.example.test/a.jpg' } }, dir, { now: Date.parse('2026-11-18T12:00:00Z'), fetch });
  assert.equal(n, 1);
  assert.deepEqual(readFileSync(join(dir, 'examplemarket.jpg')), img);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')), { examplemarket: { file: 'examplemarket.jpg', name: 'Example Market', fetchedAt: '2026-11-18T12:00:00.000Z' } });
  assert.ok(!existsSync(join(dir, 'toobig.jpg')) && !existsSync(join(dir, 'notimage.jpg')));
  const events = stampAvatars([{ source: 'Instagram @ExampleMarket' }, { source: 'Instagram @other', avatar: 'avatars/old.jpg' }, { source: 'Visit Austin' }, { source: 'Instagram @examplemarket', account: 'examplemarket' }], dir);
  assert.deepEqual(events.map((e) => [e.account, e.avatar]), [['examplemarket', 'avatars/examplemarket.jpg'], [undefined, undefined], [undefined, undefined], ['examplemarket', 'avatars/examplemarket.jpg']]);
  // The site only ever loads a path of that exact shape.
  assert.equal(avatarPath(events[0]), 'avatars/examplemarket.jpg');
  for (const bad of ['https://evil.test/x.jpg', 'avatars/../x.jpg', 'avatars/x.svg', '/etc/passwd', '']) assert.equal(avatarPath({ avatar: bad }), null);
});
