/**
 * The Postgres the contract suites are allowed to touch.
 *
 * Those suites `DELETE FROM configurations` before every case. Until this file
 * existed they fell back to `QWA_DATABASE_URL` and then to the development default —
 * the same database `pnpm dev` serves — so running `pnpm test` while working in the
 * editor silently destroyed whatever was being edited. Test data and development data
 * now live in different databases, and this helper refuses to connect to anything
 * whose name does not say it is for tests, whatever the environment claims.
 *
 * `QWA_TEST_DATABASE_URL` overrides the location. The default database is created on
 * first use in the same server the development compose file runs, so nothing beyond
 * `docker compose up` is needed.
 */
import pg from 'pg';
import { runMigrations } from './migrate.ts';

export const DEFAULT_TEST_DATABASE_URL = 'postgres://qwa:qwa_dev_password@127.0.0.1:5433/qwa_test';

export const TEST_DATABASE_URL = process.env['QWA_TEST_DATABASE_URL'] ?? DEFAULT_TEST_DATABASE_URL;

/** Postgres SQLSTATE for "database does not exist". */
const INVALID_CATALOG_NAME = '3D000';

function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/** Throws unless the database name is unmistakably a test database. */
export function assertTestDatabaseUrl(url: string): void {
  const name = databaseName(url);
  if (!/test/i.test(name)) {
    throw new Error(
      `refusing to run destructive test suites against database "${name}" (${url.replace(/\/\/[^@]*@/, '//<credentials>@')}). ` +
        'Test databases must have "test" in their name; set QWA_TEST_DATABASE_URL accordingly.',
    );
  }
}

async function createDatabase(url: string): Promise<void> {
  const name = databaseName(url);
  // Reject anything that is not a plain identifier rather than trying to quote it.
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`test database name "${name}" is not a simple identifier`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const pool = new pg.Pool({ connectionString: admin.toString(), max: 1, connectionTimeoutMillis: 1500 });
  try {
    await pool.query(`CREATE DATABASE "${name}"`);
  } catch (error) {
    // Lost a race with another test file creating it: fine.
    if ((error as { code?: string }).code !== '42P04') throw error;
  } finally {
    await pool.end().catch(() => {});
  }
}

/**
 * A migrated pool on the test database, or null when Postgres is not reachable (the
 * suites then run their in-memory half only, and say so).
 */
export async function connectTestDatabase(options: { max?: number } = {}): Promise<pg.Pool | null> {
  assertTestDatabaseUrl(TEST_DATABASE_URL);
  const open = () => new pg.Pool({ connectionString: TEST_DATABASE_URL, max: options.max ?? 4, connectionTimeoutMillis: 1500 });

  let pool = open();
  try {
    try {
      await pool.query('SELECT 1');
    } catch (error) {
      if ((error as { code?: string }).code !== INVALID_CATALOG_NAME) throw error;
      await pool.end().catch(() => {});
      await createDatabase(TEST_DATABASE_URL);
      pool = open();
      await pool.query('SELECT 1');
    }
    await runMigrations(pool);
    return pool;
  } catch {
    await pool.end().catch(() => {});
    return null;
  }
}
