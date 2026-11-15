import { afterAll } from 'vitest';
import { connectDatabase, type Db } from '../src/db/client.js';

const url = process.env.TEST_DATABASE_URL;

/** True when database tests cannot run; use with `describe.skipIf`. */
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

/** A unique snowflake-shaped ID so tests never collide on shared tables. */
export function snowflake(): string {
  counter += 1;
  return `${Date.now()}${String(counter).padStart(5, '0')}`;
}
