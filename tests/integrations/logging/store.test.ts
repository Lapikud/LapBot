import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { logs } from '~/integrations/logging/table';
import { createLogStore } from '~/integrations/logging/store';

it('opens an existing archive without a migration journal and retains its entries', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lapbot-log-migration-'));
  const path = join(directory, 'logs.sqlite');
  const original = new Database(path);

  original.exec(readFileSync(resolve('drizzle/logs/0000_logs.sql'), 'utf8'));
  drizzle(original)
    .insert(logs)
    .values({
      id: 42,
      time: 1,
      level: 30,
      message: 'Original entry',
      source: 'app',
      details: '{}',
    })
    .run();
  original.close();
  const store = createLogStore(path);

  try {
    expect(store.page({ level: 10, query: '' }).entries).toMatchObject([
      { id: 42, message: 'Original entry' },
    ]);
    store.write(JSON.stringify({ time: 2, level: 30, msg: 'New entry' }));
    expect(
      store.page({ level: 10, query: '' }).entries.map(({ id }) => id),
    ).toEqual([43, 42]);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('searches literal text across fields and paginates matching entries', () => {
  const store = createLogStore(':memory:');

  try {
    for (let index = 0; index < 102; index++) {
      store.write(
        JSON.stringify({
          time: index,
          level: 30,
          msg: 'Literal %_ NEEDLE',
          service: 'source',
        }),
      );
    }

    store.write(
      JSON.stringify({
        time: 103,
        level: 10,
        msg: 'Literal %_ NEEDLE',
        service: 'source',
      }),
    );
    const page = store.page({ level: 30, query: '%_ needle source' });

    expect(page.entries).toHaveLength(100);
    expect(page.hasMore).toBe(true);
    const next = store.page({
      level: 30,
      query: '%_ needle source',
      before: page.entries.at(-1)?.id,
    });

    expect(next.entries).toHaveLength(2);
    expect(next.hasMore).toBe(false);
  } finally {
    store.close();
  }
});
