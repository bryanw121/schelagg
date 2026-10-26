import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPublished, PUBLISHED_URL } from '../lib/check.js';

const dir = mkdtempSync(join(tmpdir(), 'schelagg-pub-'));
const bundled = join(dir, 'schedule.json');
writeFileSync(bundled, JSON.stringify({ sessions: [{ id: 'bundled-1' }] }));
const json = (body, ok = true) => async () => ({ ok, json: async () => body });

test('published schedule: the GitHub Pages copy wins when it answers', async () => {
  let asked;
  const map = await loadPublished({ path: bundled, fetch: async (url) => { asked = url; return json({ sessions: [{ id: 'live-1' }, { id: 'live-2' }] })(); } });
  assert.equal(asked, PUBLISHED_URL);
  assert.deepEqual([...map.keys()], ['live-1', 'live-2']);
});

test('published schedule: falls back to the bundled copy when Pages fails or sends junk', async () => {
  for (const f of [
    async () => { throw new Error('offline'); },
    json({}, false),
    json({ nope: true }),
  ]) {
    const map = await loadPublished({ path: bundled, fetch: f });
    assert.deepEqual([...map.keys()], ['bundled-1']);
  }
});

test('published schedule: empty when neither copy loads', async () => {
  const map = await loadPublished({ path: join(dir, 'missing.json'), fetch: async () => { throw new Error('offline'); } });
  assert.equal(map.size, 0);
});

// Vercel skips a build when ignoreCommand exits 0: only for commits that touch nothing but public/data.
test('vercel ignoreCommand skips data-only commits and builds everything else', { skip: process.platform === 'win32' }, () => {
  const cmd = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).ignoreCommand;
  const repo = mkdtempSync(join(tmpdir(), 'schelagg-ign-'));
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@e.st'); git('config', 'user.name', 't');
  mkdirSync(join(repo, 'public', 'data'), { recursive: true }); mkdirSync(join(repo, 'api'));
  writeFileSync(join(repo, 'public', 'data', 'schedule.json'), '1'); writeFileSync(join(repo, 'api', 'check.js'), '1');
  git('add', '-A'); git('commit', '-qm', 'base');
  const skips = () => { try { execFileSync('sh', ['-c', cmd], { cwd: repo, stdio: 'pipe' }); return true; } catch { return false; } };

  writeFileSync(join(repo, 'public', 'data', 'schedule.json'), '2'); git('commit', '-qam', 'data');
  assert.equal(skips(), true, 'data-only commit is skipped');
  writeFileSync(join(repo, 'api', 'check.js'), '2'); writeFileSync(join(repo, 'public', 'data', 'schedule.json'), '3'); git('commit', '-qam', 'code+data');
  assert.equal(skips(), false, 'a commit touching code builds');
});
