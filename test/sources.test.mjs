// The sources page: what each source publishes about itself (lib/sources.js) and how the page words
// it (public/sources.js: gives / offers / render).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clubName, sourceInfo, sourceLinks, sourceSite, KINDS } from '../lib/sources.js';
import { loadSources } from '../lib/registry.js';
import { readFileSync } from 'node:fs';
import { gives, offers, render } from '../public/sources.js';

test('every configured source has a link (or its groups) and a kind', () => {
  for (const s of loadSources().sources) {
    const i = sourceInfo(s, s.adapter.id);
    assert.ok(i.site || i.links?.length, `${s.id}: no link`);
    assert.ok(i.kind, `${s.id}: no kind (add the adapter to KINDS)`);
  }
  for (const s of JSON.parse(readFileSync(new URL('../config/programs.json', import.meta.url), 'utf8')).sources) {
    assert.ok(s.name, `programs ${s.id}: no name`);
    assert.ok(sourceSite(s), `programs ${s.id}: no link`);
    assert.ok(KINDS[s.reader], `programs ${s.id}: no kind`);
  }
});

test('groups and clubs a source reads are listed by name', () => {
  assert.deepEqual(sourceLinks({ feeds: [{ url: 'https://www.meetup.com/a-group/events/ical/', host: 'A Group' }] }), [{ name: 'A Group', url: 'https://www.meetup.com/a-group/' }]);
  assert.deepEqual(sourceLinks({ clubs: ['https://reclub.co/clubs/@a'] }), []); // one club: the source's own link
  assert.equal(clubName('https://reclub.co/clubs/@ync-volleyball-dallas-texas-usa-95'), 'YNC Volleyball');
  assert.equal(clubName('https://reclub.co/clubs/@recreational-dfw-dallas-texas-usa-18'), 'Recreational DFW');
  assert.equal(clubName('https://reclub.co/clubs/@volleyworld-gym'), 'Volleyworld Gym');
  assert.equal(clubName('https://reclub.co/clubs/@htx-meet-up'), 'HTX Meet Up');
  assert.equal(sourceSite({ site: 'https://x.test/', options: { url: 'https://y.test/' } }), 'https://x.test/');
  assert.equal(sourceSite({ options: { discover: { url: 'https://no.test/' }, feeds: [{ url: 'https://www.meetup.com/g/events/ical/' }] } }), 'https://www.meetup.com/g/');
});

test('the count column says what the number is', () => {
  const s = [{ date: '2026-11-16' }, { date: '2026-11-20' }, { date: '2026-11-30' }, { days: ['Mon'] }, { days: ['Sat'], validUntil: '2026-11-01' }];
  assert.equal(gives(s, '2026-11-15', '2026-11-21'), '2 sessions this week · 1 weekly time slot');
  assert.equal(gives([{ date: '2026-11-16' }], '2026-11-15', '2026-11-21'), '1 session this week');
  assert.equal(gives([], '2026-11-15', '2026-11-21'), 'None posted right now');
  assert.equal(offers([{ kind: 'league' }, { kind: 'league' }, { kind: 'tournament' }]), '2 leagues · 1 tournament open for sign-up');
  assert.equal(offers([]), 'None open for sign-up right now');
});

test('render: sports first, then leagues; failing sources say since when and why; multi-group names are not links', () => {
  const region = { id: 'dallas', name: 'Dallas–Fort Worth, TX', timezone: 'America/Chicago' };
  const schedule = {
    sources: [
      { id: 'meetup', name: 'Meetup · DFW', sport: 'volleyball', ok: true, checkedAt: '2026-11-15T15:00:00Z', kind: 'Meetup group calendars', site: 'https://www.meetup.com/a/', links: [{ name: 'A', url: 'https://www.meetup.com/a/' }, { name: 'B', url: 'https://www.meetup.com/b/' }] },
      { id: 'reclub', name: 'Reclub · DFW clubs', sport: 'volleyball', ok: false, checkedAt: '2026-11-15T15:00:00Z', failingSince: '2026-11-13T15:00:00Z', error: 'No Reclub meets found', kept: 0, kind: 'Reclub club pages', site: 'https://reclub.co/clubs/@a' },
    ],
    sessions: [{ sourceId: 'meetup', sport: 'volleyball', date: '2026-11-16' }],
  };
  const programs = { sources: [{ id: 'lonestar', name: 'Lone Star SSC', ok: true, checkedAt: '2026-11-15T12:00:00Z', site: 'https://l.test/', regions: ['dallas'] }, { id: 'nagva', name: 'NAGVA', ok: true, checkedAt: '2026-11-15T12:00:00Z', site: 'https://n.test/' }, { id: 'austin-only', name: 'Austin SSC', ok: true, regions: ['austin'] }],
    programs: [{ feed_source: 'lonestar', region: 'dallas', kind: 'league' }, { feed_source: 'nagva', region: 'texas', kind: 'tournament' }, { feed_source: 'austin-only', region: 'austin', kind: 'league' }] };
  const html = render({ region, schedule, programs, sport: 'volleyball', now: Date.parse('2026-11-15T16:00:00Z') });
  assert.match(html, /Volleyball · open play/);
  assert.match(html, /1 session this week/);
  assert.match(html, /Not working since Nov 13 · No Reclub meets found/);
  assert.doesNotMatch(html, /<a href="https:\/\/www\.meetup\.com\/a\/" target="_blank" rel="noopener">Meetup · DFW/); // the groups are linked, not the name
  assert.match(html, /<a href="https:\/\/www\.meetup\.com\/b\/"[^>]*>B<\/a>/);
  assert.match(html, /Lone Star SSC[\s\S]*1 league open for sign-up/);
  assert.match(html, /NAGVA[\s\S]*1 tournament across the state/);
  assert.doesNotMatch(html, /Austin SSC/);
  assert.ok(html.indexOf('open play') < html.indexOf('Leagues &amp; tournaments'));
});
