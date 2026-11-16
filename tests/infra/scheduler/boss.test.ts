import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Job } from '~/core/ports';
import { PermanentError } from '~/domain';
import { createJobQueue, startJobs } from '~/infra/scheduler';
import { silentLog } from '../../fakes';
import { noDatabase } from '../../db';

describe.skipIf(noDatabase)('pg-boss scheduler', () => {
  const boss = new PgBoss(process.env.TEST_DATABASE_URL ?? '');
  const scheduler = createJobQueue(boss);
  const later = new Date(Date.now() + 60 * 60 * 1000);
  const idle: Job<{ n: number }> = { type: 'test-idle', run: async () => null };
  const recurring: Job<{ n: number }> = {
    type: 'test-recurring',
    run: vi.fn(async () => ({ rescheduleAt: later })),
  };
  const broken: Job<{ n: number }> = {
    type: 'test-broken',
    run: vi.fn(async () => {
      throw new PermanentError('bad');
    }),
  };
  const queued = async (job: Job<{ n: number }>, key: string) =>
    boss.findJobs<{ n: number }>(job.type, { key, queued: true });

  beforeAll(async () => {
    await boss.start();
    await startJobs(boss, [idle, recurring, broken], silentLog);
  });

  afterAll(async () => {
    await boss.stop();
  });

  it('keeps one queued job per key and cancels it', async () => {
    await scheduler.schedule(idle, { n: 1 }, { runAt: later, key: 'a' });
    await scheduler.schedule(idle, { n: 2 }, { runAt: later, key: 'a' });

    const jobs = await queued(idle, 'a');

    expect(jobs.map((job) => job.data.n)).toEqual([2]);

    await scheduler.cancel(idle, 'a');
    expect(await queued(idle, 'a')).toHaveLength(0);
  });

  it('queues the next run of a job that reschedules itself', async () => {
    await scheduler.schedule(
      recurring,
      { n: 1 },
      { runAt: new Date(), key: 'r' },
    );

    await vi.waitFor(
      async () => {
        const [next] = await queued(recurring, 'r');

        expect(next?.startAfter.getTime()).toBe(later.getTime());
      },
      { timeout: 10_000, interval: 250 },
    );
    expect(recurring.run).toHaveBeenCalledOnce();
  });

  it('does not retry permanent failures', async () => {
    await scheduler.schedule(broken, { n: 1 }, { runAt: new Date(), key: 'b' });

    await vi.waitFor(
      async () => {
        const [job] = await boss.findJobs(broken.type, { key: 'b' });

        expect(job?.state).toBe('failed');
      },
      { timeout: 10_000, interval: 250 },
    );
    expect(broken.run).toHaveBeenCalledOnce();
  });
});
