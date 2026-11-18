import { resolve } from 'node:path';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { ignore } from '~/core/errors';

export type Db = PostgresJsDatabase;

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface Database {
  db: Db;
  close: () => Promise<void>;
}

const migrationsFolder = resolve('drizzle');

export function connectDatabase(url: string): Database {
  const sql = postgres(url, { max: 10, onnotice: ignore });

  return {
    db: drizzle(sql),
    close: () => sql.end({ timeout: 5 }),
  };
}

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder });
}
