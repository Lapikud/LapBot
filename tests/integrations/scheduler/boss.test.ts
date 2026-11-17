import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Job } from '~/core/ports/scheduler';
import { createJobQueue, startJobs } from '~/integrations/scheduler/boss';
import { noDatabase } from '../../db';
import { silentLog } from '../../fakes';

describe.skipIf(noDatabase)('pg-boss scheduler', () => {
  let boss: PgBoss;
  let scheduler: ReturnType<typeof createJobQueue>;
  const later = new Date(Date.now() + 60 * 60 * 1000);
  const idle: Job<{ n: number }> = { type: 'test-idle', run: async () => null };
  const queued = async (job: Job<{ n: number }>, key: string) =>
    boss.findJobs<{ n: number }>(job.type, { key, queued: true });

  beforeAll(async () => {
    boss = new PgBoss(process.env.TEST_DATABASE_URL ?? '');
    scheduler = createJobQueue(boss);
    await boss.start();
    await startJobs(boss, [idle], silentLog);
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
});
