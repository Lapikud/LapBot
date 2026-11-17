import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogStore } from '~/integrations/logging/store';
import { createLogger } from '~/integrations/logging/logger';

const directories: string[] = [];
const stores: Array<ReturnType<typeof createLogStore>> = [];

function archive(path = ':memory:') {
  const store = createLogStore(path);

  stores.push(store);

  return store;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) {
    store.close();
  }

  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('captures redacted structured entries, child context and serialized errors', () => {
  const logs = archive();
  const log = createLogger('info', logs).child({ service: 'polls' });

  log.debug('hidden by configured level');
  log.error(
    {
      token: 'root-secret',
      credentials: { password: 'nested-secret' },
      err: new Error('Discord unavailable'),
    },
    'Could not update poll',
  );
  const entries = logs.page({ level: 10, query: '' }).entries;

  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    level: 50,
    source: 'polls',
    message: 'Could not update poll',
  });
  expect(entries[0]?.details).toContain('Discord unavailable');
  expect(entries[0]?.details).toContain('[redacted]');
  expect(JSON.stringify(entries)).not.toContain('root-secret');
  expect(JSON.stringify(entries)).not.toContain('nested-secret');
});

it('keeps complete entries beyond 500 across reopen and paginates all history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lapbot-logs-'));

  directories.push(directory);
  const path = join(directory, 'history.sqlite');
  const logs = archive(path);

  for (let index = 0; index < 501; index++) {
    logs.write(
      JSON.stringify({
        time: index,
        level: 30,
        msg: index === 0 ? 'unique-oldest' : String(index),
        payload: 'x'.repeat(20_000),
      }),
    );
  }

  logs.close();
  const reopened = archive(path);
  const oldest = reopened.page({ level: 10, query: 'unique-oldest' });

  expect(oldest.entries).toHaveLength(1);
  expect(oldest.entries[0]?.details).toContain('x'.repeat(20_000));

  let page = reopened.page({ level: 10, query: '' });
  const entries = [...page.entries];

  while (page.hasMore) {
    page = reopened.page({
      level: 10,
      query: '',
      before: page.entries.at(-1)?.id,
    });
    entries.push(...page.entries);
  }

  expect(entries).toHaveLength(501);
  expect(entries[0]?.message).toBe('500');
  expect(entries.at(-1)?.message).toBe('unique-oldest');
  expect(new Set(entries.map((entry) => entry.id)).size).toBe(501);
});

it('reports archive write failures explicitly while preserving stdout logging', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const log = createLogger('info', {
    write: () => {
      throw new Error('disk full');
    },
  });

  expect(() => log.info('Still visible on stdout')).not.toThrow();
  expect(stderr).toHaveBeenCalledWith(expect.stringContaining('disk full'));
});
