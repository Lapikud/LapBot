import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { and, count, desc, gte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { logs } from './table';
import { z } from 'zod';

export const logPageSize = 100;

const record = z
  .object({
    time: z.number(),
    level: z.number(),
    msg: z.string().default(''),
  })
  .catchall(z.unknown());

export type LogEntry = typeof logs.$inferSelect;

export function createLogStore(path: string) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }

  const database = new Database(path);

  if (path !== ':memory:') {
    chmodSync(path, 0o600);
  }

  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = FULL');
  database.function(
    'log_contains',
    { deterministic: true },
    (text: string, query: string) => Number(text.toLowerCase().includes(query)),
  );
  const db = drizzle(database);

  migrate(db, { migrationsFolder: resolve('drizzle/logs') });

  return {
    write: (line: string): void => {
      const { time, level, msg, ...details } = record.parse(JSON.parse(line));
      const source = details.service ?? details.component ?? details.feature;

      db.insert(logs)
        .values({
          time,
          level,
          message: msg,
          source: typeof source === 'string' ? source : 'app',
          details: JSON.stringify(details, null, 2),
        })
        .run();
    },
    page: (input: { level: number; query: string; page?: number }) => {
      const query = input.query.toLowerCase();
      const where = and(
        gte(logs.level, input.level),
        query === ''
          ? undefined
          : sql`log_contains(${logs.message} || ' ' || ${logs.source} || ' ' || ${logs.details}, ${query}) = 1`,
      );
      const total =
        db.select({ value: count() }).from(logs).where(where).get()?.value ?? 0;
      const pages = Math.max(1, Math.ceil(total / logPageSize));
      const page = Math.min(Math.max(1, input.page ?? 1), pages);
      const entries = db
        .select()
        .from(logs)
        .where(where)
        .orderBy(desc(logs.id))
        .limit(logPageSize)
        .offset((page - 1) * logPageSize)
        .all();

      return { entries, total, page, pages, hasMore: page < pages };
    },
    close: () => {
      if (database.open) {
        database.close();
      }
    },
  };
}

export type LogStore = ReturnType<typeof createLogStore>;
