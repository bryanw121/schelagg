// Local dev server: serves public/ and mounts the same API handlers Vercel uses.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname, normalize, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import courts from './api/courts.js';
import check from './api/check.js';
import sessions from './api/sessions.js';
import { loadEnv } from './lib/paths.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
// Handlers read DATABASE_URL_READONLY on first request, so a .env set here still applies.
loadEnv();
const API = { '/api/courts': courts, '/api/check': check, '/api/sessions': sessions };
const PORT = process.env.PORT || 5173;

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://local').pathname;
  try {
    if (API[path]) return await API[path](req, res);
    const file = normalize(join(PUBLIC, path === '/' ? 'index.html' : path));
    const rel = relative(PUBLIC, file);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('outside public');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    if (path.startsWith('/api/')) {
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, function () {
  // PORT=0 picks a free port (the e2e tests do this); print the one we got.
  console.log(`Schelagg → http://localhost:${this.address().port}`);
});
