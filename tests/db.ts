import { afterAll } from 'vitest';
import { connectDatabase, type Db } from '~/integrations/db/client';

const url = process.env.TEST_DATABASE_URL;

export const noDatabase = url === undefined;

let database: ReturnType<typeof connectDatabase> | undefined;

export function testDb(): Db {
  if (url === undefined) {
    throw new Error('TEST_DATABASE_URL is not set');
  }

  database ??= connectDatabase(url);

  return database.db;
}

afterAll(async () => {
  await database?.close();
  database = undefined;
});

let counter = 0;

export function snowflake(): string {
  counter += 1;

  return `${Date.now()}${String(counter).padStart(5, '0')}`;
}
