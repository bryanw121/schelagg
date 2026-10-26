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

// Scrape output is pushed to the data branch; Vercel must never deploy it.
test('vercel never deploys the data branch', () => {
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(cfg.git?.deploymentEnabled?.data, false);
  assert.equal(cfg.ignoreCommand, undefined, 'skipped builds still count against the deployment limit; use the data branch instead');
});

// scripts/data-branch.sh: push creates/updates the data branch from the working tree; pull overlays it.
test('data branch: push then pull round-trips the data files, main untouched', { skip: process.platform === 'win32' }, () => {
  const script = new URL('../scripts/data-branch.sh', import.meta.url).pathname;
  const root = mkdtempSync(join(tmpdir(), 'schelagg-data-'));
  const remote = join(root, 'remote.git');
  const sh = (cwd, ...a) => execFileSync(a[0], a.slice(1), { cwd, stdio: 'pipe', encoding: 'utf8' });
  sh(root, 'git', 'init', '-q', '--bare', remote);
  const a = join(root, 'a');
  sh(root, 'git', 'clone', '-q', remote, a);
  for (const [k, v] of [['user.email', 't@e.st'], ['user.name', 't']]) sh(a, 'git', 'config', k, v);
  mkdirSync(join(a, 'public', 'data'), { recursive: true }); mkdirSync(join(a, 'data'));
  writeFileSync(join(a, 'public', 'data', 'schedule.json'), 'seed'); writeFileSync(join(a, 'code.js'), 'x');
  sh(a, 'git', 'add', '-A'); sh(a, 'git', 'commit', '-qm', 'main'); sh(a, 'git', 'push', '-q', 'origin', 'HEAD:main');

  writeFileSync(join(a, 'public', 'data', 'schedule.json'), 'run-1');
  writeFileSync(join(a, 'data', 'health.json'), '{"ok":1}');
  sh(a, 'bash', script, 'push', 'Refresh 1');
  assert.equal(sh(a, 'git', 'show', 'origin/data:public/data/schedule.json'), 'run-1');
  assert.equal(sh(a, 'git', 'show', 'origin/main:public/data/schedule.json'), 'seed', 'main keeps its seed copy');
  // An unchanged run makes no commit.
  sh(a, 'bash', script, 'push', 'Refresh 2');
  assert.equal(sh(a, 'git', 'log', '--format=%s', 'origin/data').trim(), 'Refresh 1');

  const b = join(root, 'b');
  sh(root, 'git', 'clone', '-q', '-b', 'main', remote, b);
  assert.equal(readFileSync(join(b, 'public', 'data', 'schedule.json'), 'utf8'), 'seed');
  sh(b, 'bash', script, 'pull');
  assert.equal(readFileSync(join(b, 'public', 'data', 'schedule.json'), 'utf8'), 'run-1');
  assert.equal(readFileSync(join(b, 'data', 'health.json'), 'utf8'), '{"ok":1}');
});
