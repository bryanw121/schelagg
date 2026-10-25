// Repo-anchored file paths, so scripts behave the same whatever directory
// they're started from and on any OS (Node turns these into native paths).
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);

/** Absolute native path for a repo-relative POSIX path, e.g. repoPath('data/watch.json'). */
export const repoPath = (rel) => fileURLToPath(new URL(rel, ROOT));

/**
 * Load a `.env` file at the repo root into process.env (existing variables
 * win). Replaces shell-specific `VAR=value node ...` syntax, which doesn't work
 * in Windows cmd or PowerShell.
 */
export function loadEnv() {
  try {
    process.loadEnvFile(repoPath('.env'));
  } catch {
    // No .env (or Node older than 20.12): rely on the real environment.
  }
}
