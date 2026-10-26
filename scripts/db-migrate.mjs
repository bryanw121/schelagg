// Apply db/migrations/*.sql to Schelagg's database, then db/grants.sql (lib/db.js migrate).
// Idempotent: applied migrations are recorded in schema_migrations. Runs before every scrape.
// Without DATABASE_URL (the Neon owner connection string) it does nothing and exits 0.
import { loadEnv } from '../lib/paths.js';
import { connect, migrate, redact } from '../lib/db.js';

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.log('::notice::DATABASE_URL is not set; skipping database migrations.');
  process.exit(0);
}
const db = await connect(url);
try {
  const { applied } = await migrate(db);
  console.log(applied.length ? `Applied ${applied.length} migration(s): ${applied.join(', ')}` : 'Database schema is up to date.');
} catch (e) {
  console.error(`Migration failed: ${redact(e?.message ?? e)}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
