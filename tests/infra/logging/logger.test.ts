import { expect, it } from 'vitest';
import { createLogBuffer, createLogger } from '~/infra/logging';

it('captures redacted structured entries, child context and serialized errors', () => {
  const logs = createLogBuffer();
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
  const entries = logs.entries();

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

it('bounds retained entries and their size, keeping the newest first', () => {
  const logs = createLogBuffer();

  for (let index = 0; index < 501; index++) {
    logs.write(
      JSON.stringify({
        time: index,
        level: 30,
        msg: String(index),
        payload: 'x'.repeat(20_000),
      }),
    );
  }

  const entries = logs.entries();

  expect(entries).toHaveLength(500);
  expect(entries[0]?.message).toBe('500');
  expect(entries.at(-1)?.message).toBe('1');
  expect(entries.every((entry) => entry.details.length <= 8192)).toBe(true);
});
