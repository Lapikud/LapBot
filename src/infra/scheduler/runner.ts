import { setTimeout as sleep } from 'node:timers/promises';
import type { Db, JobRow } from '~/infra/db';
import { PermanentError } from '~/domain';
import type { Job, Logger } from '~/core/ports';
import { claimDueJobs, finishJob } from '~/infra/db';

export type RunnerOptions = {
  pollIntervalMs?: number;
  batchSize?: number;
  leaseMs?: number;
};

export type JobRunner = {
  tick: () => Promise<number>;
  start: () => void;
  stop: () => Promise<void>;
};

const maxBackoffMs = 60 * 60 * 1000;

export function retryDelayMs(attempt: number): number {
  return Math.min(30_000 * 2 ** (attempt - 1), maxBackoffMs);
}

export function createJobRunner(
  db: Db,
  jobs: ReadonlyMap<string, Job<unknown>>,
  log: Logger,
  options: RunnerOptions = {},
): JobRunner {
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const batchSize = options.batchSize ?? 10;
  const leaseMs = options.leaseMs ?? 5 * 60 * 1000;
  const types = [...jobs.keys()];
  const abort = new AbortController();
  let loop: Promise<void> | undefined;

  async function execute(row: JobRow): Promise<void> {
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
      const outcome = await job.run(row.payload, {
        id: row.id,
        runAt: row.runAt,
        attempt: row.attempts,
      });

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

  async function tick(): Promise<number> {
    const rows = await claimDueJobs(db, { types, limit: batchSize, leaseMs });

    await Promise.all(rows.map((row) => execute(row)));

    return rows.length;
  }

  async function run(): Promise<void> {
    while (!abort.signal.aborted) {
      let claimed = 0;

      try {
        claimed = await tick();
      } catch (error) {
        log.error({ err: error }, 'Scheduler tick failed');
      }

      if (claimed < batchSize) {
        await sleep(pollIntervalMs, undefined, { signal: abort.signal }).catch(
          () => false,
        );
      }
    }
  }

  return {
    tick,
    start: () => {
      loop ??= run();
    },
    stop: async () => {
      abort.abort();
      await loop;
    },
  };
}
