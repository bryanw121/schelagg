// After scripts/scrape-home.mjs: commit each data/offsite/<id>.json to the data branch through
// GitHub's contents API (no git or bash needed on the home computer, and a commit that only
// touches this file never conflicts with the main scrape's pushes). Needs GITHUB_TOKEN and
// GITHUB_REPOSITORY, which Actions provides.
import { readdirSync, readFileSync } from 'node:fs';
import { repoPath } from '../lib/paths.js';

const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo } = process.env;
if (!token || !repo) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required');
const api = (path, init = {}) => fetch(`https://api.github.com/repos/${repo}/${path}`, {
  ...init,
  headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...init.headers },
});

let files = [];
try { files = readdirSync(repoPath('data/offsite')).filter((f) => f.endsWith('.json')); } catch { /* nothing scraped */ }
for (const f of files) {
  const path = `data/offsite/${f}`;
  const content = Buffer.from(readFileSync(repoPath(path))).toString('base64');
  for (let attempt = 1; ; attempt++) {
    const cur = await api(`contents/${path}?ref=data`);
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    const res = await api(`contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ message: `Home runner: ${f.replace(/\.json$/, '')} ${new Date().toISOString().slice(0, 16)}Z`, content, branch: 'data', sha }),
    });
    if (res.ok) { console.log(`pushed ${path}`); break; }
    // 409/422: the file or branch moved under us; fetch the new sha and retry.
    if (attempt >= 3 || ![409, 422].includes(res.status)) throw new Error(`push ${path}: HTTP ${res.status} ${await res.text()}`);
  }
}
