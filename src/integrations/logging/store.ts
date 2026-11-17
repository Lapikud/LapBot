import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export const logPageSize = 100;

const record = z
  .object({
    time: z.number(),
    level: z.number(),
    msg: z.string().default(''),
  })
  .catchall(z.unknown());

const entry = z.object({
  id: z.number(),
  time: z.number(),
  level: z.number(),
  message: z.string(),
  source: z.string(),
  details: z.string(),
});

export type LogEntry = z.infer<typeof entry>;

export function createLogStore(path: string) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }

  const database = new DatabaseSync(path);

  if (path !== ':memory:') {
    chmodSync(path, 0o600);
  }

  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY,
      time INTEGER NOT NULL,
      level INTEGER NOT NULL,
      message TEXT NOT NULL,
      source TEXT NOT NULL,
      details TEXT NOT NULL
    );
  `);
  const insert = database.prepare(
    'INSERT INTO logs (time, level, message, source, details) VALUES (?, ?, ?, ?, ?)',
  );
  const select = database.prepare(`
    SELECT * FROM logs
    WHERE id < ? AND level >= ?
      AND instr(lower(message || ' ' || source || ' ' || details), lower(?)) > 0
    ORDER BY id DESC LIMIT ?
  `);

  return {
    write: (line: string): void => {
      const { time, level, msg, ...details } = record.parse(JSON.parse(line));
      const source = details.service ?? details.component ?? details.feature;

      insert.run(
        time,
        level,
        msg,
        typeof source === 'string' ? source : 'app',
        JSON.stringify(details, null, 2),
      );
    },
    page: (input: {
      level: number;
      query: string;
      before?: number | undefined;
    }) => {
      const rows = select.all(
        input.before ?? Number.MAX_SAFE_INTEGER,
        input.level,
        input.query,
        logPageSize + 1,
      );

      return {
        entries: rows.slice(0, logPageSize).map((row) => entry.parse(row)),
        hasMore: rows.length > logPageSize,
      };
    },
    close: () => {
      if (database.isOpen) {
        database.close();
      }
    },
  };
}

export type LogStore = ReturnType<typeof createLogStore>;
