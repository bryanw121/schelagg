// Local dev server: serves public/ and mounts the same API handlers Vercel uses.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname, normalize, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import courts from './api/courts.js';
import check from './api/check.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const API = { '/api/courts': courts, '/api/check': check };
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
}).listen(PORT, () => console.log(`Schelagg → http://localhost:${PORT}`));
