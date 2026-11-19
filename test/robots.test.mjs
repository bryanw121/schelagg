import test from 'node:test';
import assert from 'node:assert/strict';
import { robotsAllows, starRules } from '../lib/robots.js';

const ROBOTS = `# comment
User-agent: GPTBot
Disallow: /

User-agent: *
Disallow: /api/
Disallow: /search
Allow: /search/help
Disallow: /*?view=
Disallow: /private$
`;

test('robots: only the * group counts, and the longest matching rule wins', () => {
  assert.equal(starRules(ROBOTS).length, 5);
  assert.equal(robotsAllows(ROBOTS, '/events/'), true);
  assert.equal(robotsAllows(ROBOTS, '/api/events'), false);
  assert.equal(robotsAllows(ROBOTS, '/search?q=x'), false);
  assert.equal(robotsAllows(ROBOTS, '/search/help'), true, 'the longer Allow wins');
  assert.equal(robotsAllows(ROBOTS, '/events/?view=list'), false, 'a * in the middle');
  assert.equal(robotsAllows(ROBOTS, '/private'), false);
  assert.equal(robotsAllows(ROBOTS, '/private/party'), true, '$ ends the match');
});

test('robots: nothing disallowed without rules; a site that shuts everyone out is shut', () => {
  assert.equal(robotsAllows('', '/anything'), true);
  assert.equal(robotsAllows(null, '/anything'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /', '/events'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow:', '/events'), true, 'an empty Disallow allows all');
  assert.equal(robotsAllows('User-agent: a\nUser-agent: *\nDisallow: /x', '/x/y'), false, 'a group naming several agents');
});
