import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { and, desc, gte, lt } from 'drizzle-orm';
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
    page: (input: { level: number; query: string; before?: number }) => {
      const query = input.query.toLowerCase();
      const rows: LogEntry[] = [];
      let before = input.before ?? Number.MAX_SAFE_INTEGER;

      while (rows.length <= logPageSize) {
        const candidates = db
          .select()
          .from(logs)
          .where(and(lt(logs.id, before), gte(logs.level, input.level)))
          .orderBy(desc(logs.id))
          .limit(logPageSize + 1)
          .all();

        for (const row of candidates) {
          if (
            `${row.message} ${row.source} ${row.details}`
              .toLowerCase()
              .includes(query)
          ) {
            rows.push(row);
          }

          if (rows.length > logPageSize) {
            break;
          }
        }

        const last = candidates.at(-1);

        if (last === undefined || candidates.length <= logPageSize) {
          break;
        }

        before = last.id;
      }

      return {
        entries: rows.slice(0, logPageSize),
        hasMore: rows.length > logPageSize,
      };
    },
    close: () => {
      if (database.open) {
        database.close();
      }
    },
  };
}

export type LogStore = ReturnType<typeof createLogStore>;
