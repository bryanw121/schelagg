// The config "Add a source" checks against and writes to, read from the repository's files.
import { readFileSync, writeFileSync } from 'node:fs';
import { repoPath } from './paths.js';
import { loadRegions, regionFile } from './regions.js';

const json = (rel, fallback) => { try { return JSON.parse(readFileSync(repoPath(rel), 'utf8')); } catch { return fallback; } };

/** { regions: [{ info, sources, venues }], events, instagram, platforms } */
export const loadAddConfig = () => ({
  regions: loadRegions(),
  events: json('config/events.json', { sources: [] }),
  instagram: json('config/instagram.json', { accounts: [] }),
  platforms: json('config/platforms.json', { platforms: [] }),
});

/** The two files a plan can change, as text, and where each lives. */
export const planFiles = (regionId) => {
  const paths = { sources: regionFile(regionId, 'sources.json'), events: repoPath('config/events.json') };
  return { paths, files: { sources: readFileSync(paths.sources, 'utf8'), events: readFileSync(paths.events, 'utf8') }, write: (file, text) => writeFileSync(paths[file], text) };
};
