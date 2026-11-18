import postgres from 'postgres';
import { connectDatabase, runMigrations } from '~/integrations/db/client';

export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;

  if (url === undefined) {
    console.warn('TEST_DATABASE_URL is not set; database tests are skipped.');

    return;
  }

  const target = new URL(url);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  const application = process.env.DATABASE_URL;

  if (!databaseName.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL database name must end in _test.');
  }

  if (application !== undefined && application !== '') {
    const live = new URL(application);

    if (
      target.hostname === live.hostname &&
      (target.port || '5432') === (live.port || '5432') &&
      databaseName === decodeURIComponent(live.pathname.slice(1))
    ) {
      throw new Error(
        'TEST_DATABASE_URL must not target the application database.',
      );
    }
  }

  const sql = postgres(url, { onnotice: () => null });

  await sql`DROP SCHEMA IF EXISTS public CASCADE`;
  await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
  await sql`DROP SCHEMA IF EXISTS pgboss CASCADE`;
  await sql`CREATE SCHEMA public`;
  await sql.end();
  const database = connectDatabase(url);

  await runMigrations(database.db);
  await database.close();
}
