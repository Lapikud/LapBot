import { setTimeout as sleep } from 'node:timers/promises';
import type { Db } from '../../db/client.js';
import { PermanentError } from '../../shared/errors.js';
import type { AppContext, Job, Scheduler } from '../feature.js';
import type { Logger } from '../logger.js';
import type { JobRow } from './schema.js';
import { cancelJob, claimDueJobs, finishJob, upsertJob } from './store.js';

export type SchedulerOptions = {
  pollIntervalMs?: number;
  batchSize?: number;
  leaseMs?: number;
};

export type SchedulerRuntime = Scheduler & {
  /** Claims and runs one batch; returns how many jobs were claimed. */
  tick: (ctx: AppContext) => Promise<number>;
  start: (ctx: AppContext) => void;
  stop: () => Promise<void>;
};

const maxBackoffMs = 60 * 60 * 1000;

export function retryDelayMs(attempt: number): number {
  return Math.min(30_000 * 2 ** (attempt - 1), maxBackoffMs);
}

/**
 * One persistent, database-backed scheduler shared by every feature. Delivery
 * is at-least-once: a handler may run again if the process dies mid-job, so
 * handlers must be idempotent.
 */
export function createScheduler(
  db: Db,
  jobs: ReadonlyMap<string, Job<unknown>>,
  log: Logger,
  options: SchedulerOptions = {},
): SchedulerRuntime {
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const batchSize = options.batchSize ?? 10;
  const leaseMs = options.leaseMs ?? 5 * 60 * 1000;
  const types = [...jobs.keys()];
  const abort = new AbortController();
  let loop: Promise<void> | undefined;

  async function execute(row: JobRow, ctx: AppContext): Promise<void> {
    const job = jobs.get(row.type);
    const jobLog = log.child({ jobId: row.id, jobType: row.type });
    if (!job) {
      return;
    }
    if (row.attempts > row.maxAttempts) {
      await finishJob(db, row.id, {
        kind: 'failed',
        error: 'Exceeded max attempts',
      });
      return;
    }
    try {
      const outcome = await job.run(
        row.payload,
        { id: row.id, runAt: row.runAt, attempt: row.attempts },
        { ...ctx, log: jobLog },
      );
      await finishJob(
        db,
        row.id,
        outcome
          ? { kind: 'reschedule', runAt: outcome.rescheduleAt }
          : { kind: 'done' },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const permanent =
        error instanceof PermanentError || row.attempts >= row.maxAttempts;
      jobLog.error(
        { err: error, attempt: row.attempts, permanent },
        'Job failed',
      );
      await finishJob(
        db,
        row.id,
        permanent
          ? { kind: 'failed', error: message }
          : {
              kind: 'retry',
              error: message,
              runAt: new Date(Date.now() + retryDelayMs(row.attempts)),
            },
      );
    }
  }

  async function tick(ctx: AppContext): Promise<number> {
    const rows = await claimDueJobs(db, { types, limit: batchSize, leaseMs });
    await Promise.all(rows.map((row) => execute(row, ctx)));
    return rows.length;
  }

  async function run(ctx: AppContext): Promise<void> {
    while (!abort.signal.aborted) {
      let claimed = 0;
      try {
        claimed = await tick(ctx);
      } catch (error) {
        log.error({ err: error }, 'Scheduler tick failed');
      }
      // A full batch suggests a backlog, so poll again immediately.
      if (claimed < batchSize) {
        await sleep(pollIntervalMs, undefined, { signal: abort.signal }).catch(
          () => false,
        );
      }
    }
  }

  return {
    schedule: async (job, payload, scheduleOptions) => {
      await upsertJob(db, {
        type: job.type,
        payload,
        runAt: scheduleOptions.runAt,
        key: scheduleOptions.key,
        maxAttempts: scheduleOptions.maxAttempts ?? job.maxAttempts,
      });
    },
    cancel: (key) => cancelJob(db, key),
    tick,
    start: (ctx) => {
      loop ??= run(ctx);
    },
    stop: async () => {
      abort.abort();
      await loop;
    },
  };
}
