import postgres from 'postgres';
import { connectDatabase, runMigrations } from '~/db/client';

export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;

  if (url === undefined) {
    console.warn('TEST_DATABASE_URL is not set; database tests are skipped.');

    return;
  }

  const sql = postgres(url, { onnotice: () => null });

  await sql`DROP SCHEMA IF EXISTS public CASCADE`;
  await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
  await sql`CREATE SCHEMA public`;
  await sql.end();
  const database = connectDatabase(url);

  await runMigrations(database.db);
  await database.close();
}
