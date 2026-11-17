import { expect, it } from 'vitest';
import { createLogger } from '~/integrations/logging/logger';
import { createLogStore } from '~/integrations/logging/store';

it('captures redacted structured entries, child context and serialized errors', () => {
  const logs = createLogStore(':memory:');
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
  logs.close();
});
