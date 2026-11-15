import { eq, sql } from 'drizzle-orm';
import { pino } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { noDatabase, testDb } from '../../db';
import { PermanentError } from '~/shared/errors';
import { defineJob } from '~/core/define';
import type { AppContext } from '~/core/feature';
import { createScheduler, retryDelayMs } from '~/core/scheduler/scheduler';
import { scheduledJobs } from '~/core/scheduler/schema';
import { claimDueJobs } from '~/core/scheduler/store';

const log = pino({ level: 'silent' });

describe.skipIf(noDatabase)('scheduler', () => {
  const db = noDatabase ? undefined : testDb();
  const handle =
    vi.fn<(payload: { n: number }) => Promise<null | { rescheduleAt: Date }>>();
  const job = defineJob({
    type: 'test:job',
    payload: z.object({ n: z.number() }),
    maxAttempts: 3,
    handle: (payload) => handle(payload),
  });

  const setup = () => {
    if (!db) {
      throw new Error('unreachable');
    }

    const scheduler = createScheduler(db, new Map([[job.type, job]]), log);
    const ctx = { db, log } as unknown as AppContext;

    return { db, scheduler, ctx };
  };

  const past = () => new Date(Date.now() - 1000);
  const row = async (key: string) => {
    const { db: database } = setup();
    const [found] = await database
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.key, key));

    return found;
  };

  beforeEach(async () => {
    handle.mockReset();
    await setup().db.delete(scheduledJobs);
  });

  it('runs due jobs once and marks them done', async () => {
    const { scheduler, ctx } = setup();

    handle.mockResolvedValue(null);
    await scheduler.schedule(job, { n: 1 }, { runAt: past(), key: 'a' });
    await scheduler.schedule(
      job,
      { n: 2 },
      { runAt: new Date(Date.now() + 60_000), key: 'b' },
    );

    expect(await scheduler.tick(ctx)).toBe(1);
    expect(await scheduler.tick(ctx)).toBe(0);
    expect(handle).toHaveBeenCalledExactlyOnceWith({ n: 1 });
    expect((await row('a'))?.status).toBe('done');
    expect((await row('b'))?.status).toBe('pending');
  });

  it('replaces a pending job scheduled with the same key', async () => {
    const { scheduler, ctx } = setup();

    handle.mockResolvedValue(null);
    await scheduler.schedule(job, { n: 1 }, { runAt: past(), key: 'same' });
    await scheduler.schedule(job, { n: 2 }, { runAt: past(), key: 'same' });
    await scheduler.tick(ctx);
    expect(handle).toHaveBeenCalledExactlyOnceWith({ n: 2 });
  });

  it('does not run cancelled jobs', async () => {
    const { scheduler, ctx } = setup();

    await scheduler.schedule(job, { n: 1 }, { runAt: past(), key: 'c' });
    await scheduler.cancel('c');
    expect(await scheduler.tick(ctx)).toBe(0);
    expect((await row('c'))?.status).toBe('cancelled');
  });

  it('retries transient failures with backoff, then fails', async () => {
    const { db: database, scheduler, ctx } = setup();

    handle.mockRejectedValue(new Error('discord down'));
    await scheduler.schedule(job, { n: 1 }, { runAt: past(), key: 'r' });

    for (let attempt = 1; attempt <= 3; attempt++) {
      await scheduler.tick(ctx);
      const current = await row('r');

      expect(current?.attempts).toBe(attempt);
      if (attempt < 3) {
        expect(current?.status).toBe('pending');
        expect(current?.runAt.getTime()).toBeGreaterThan(Date.now());
        await database
          .update(scheduledJobs)
          .set({ runAt: past() })
          .where(eq(scheduledJobs.key, 'r'));
      }
    }

    expect((await row('r'))?.status).toBe('failed');
    expect((await row('r'))?.lastError).toBe('discord down');
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });

  it('does not retry permanent failures or invalid payloads', async () => {
    const { db: database, scheduler, ctx } = setup();

    handle.mockRejectedValue(new PermanentError('user blocked DMs'));
    await scheduler.schedule(job, { n: 1 }, { runAt: past(), key: 'p' });
    await database.insert(scheduledJobs).values({
      type: job.type,
      payload: { n: 'x' },
      runAt: past(),
      key: 'bad',
    });
    await scheduler.tick(ctx);
    expect((await row('p'))?.status).toBe('failed');
    expect((await row('bad'))?.status).toBe('failed');
    expect(handle).toHaveBeenCalledOnce();
  });

  it('reschedules recurring jobs', async () => {
    const { scheduler, ctx } = setup();
    const next = new Date(Date.now() + 86_400_000);

    handle.mockResolvedValue({ rescheduleAt: next });
    await scheduler.schedule(job, { n: 1 }, { runAt: past(), key: 'rec' });
    await scheduler.tick(ctx);
    const current = await row('rec');

    expect(current?.status).toBe('pending');
    expect(current?.runAt.getTime()).toBe(next.getTime());
    expect(current?.attempts).toBe(0);
  });

  it('recovers jobs whose lease expired after a crash', async () => {
    const { db: database, scheduler, ctx } = setup();

    handle.mockResolvedValue(null);
    await scheduler.schedule(job, { n: 1 }, { runAt: past(), key: 'crash' });
    await claimDueJobs(database, {
      types: [job.type],
      limit: 10,
      leaseMs: 60_000,
    });
    expect(await scheduler.tick(ctx)).toBe(0);
    await database
      .update(scheduledJobs)
      .set({ lockedUntil: sql`now() - interval '1 second'` })
      .where(eq(scheduledJobs.key, 'crash'));
    expect(await scheduler.tick(ctx)).toBe(1);
    expect((await row('crash'))?.status).toBe('done');
  });

  it('never hands the same job to concurrent claimers', async () => {
    const { db: database, scheduler } = setup();

    for (let n = 0; n < 20; n++) {
      await scheduler.schedule(job, { n }, { runAt: past(), key: `k${n}` });
    }

    const claims = await Promise.all(
      Array.from({ length: 5 }, () =>
        claimDueJobs(database, {
          types: [job.type],
          limit: 8,
          leaseMs: 60_000,
        }),
      ),
    );
    const ids = claims.flat().map((claimed) => claimed.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(20);
  });

  it('leaves jobs of unregistered types untouched', async () => {
    const { db: database, scheduler, ctx } = setup();

    await database.insert(scheduledJobs).values({
      type: 'disabled:feature',
      payload: {},
      runAt: past(),
      key: 'off',
    });
    expect(await scheduler.tick(ctx)).toBe(0);
    expect((await row('off'))?.status).toBe('pending');
  });
});
