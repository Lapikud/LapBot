import { z } from 'zod';
import { connectDatabase, runMigrations } from '~/integrations/db/client';

const url = z.url().parse(process.env.DATABASE_URL);
const database = connectDatabase(url);

try {
  await runMigrations(database.db);
  console.log('Migrations applied.');
} finally {
  await database.close();
}
