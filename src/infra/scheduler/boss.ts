import type { JobWithMetadata, PgBoss } from 'pg-boss';
import type { Job, Logger, Scheduler } from '~/core/ports';
import { PermanentError } from '~/domain';
import { sequential } from '~/lib';

const queueOptions = {
  policy: 'short',
  retryLimit: 4,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 3600,
} as const;

export function createJobQueue(boss: PgBoss): Scheduler {
  return {
    schedule: async (job, payload, { runAt, key }) => {
      await boss.upsert(job.type, payload, {
        singletonKey: key,
        startAfter: runAt,
      });
    },
    cancel: async (job, key) => {
      const queued = await boss.findJobs(job.type, { key, queued: true });

      if (queued.length > 0) {
        await boss.cancel(
          job.type,
          queued.map((found) => found.id),
        );
      }
    },
  };
}

export async function startJobs(
  boss: PgBoss,
  jobs: Iterable<Job<unknown>>,
  log: Logger,
): Promise<void> {
  await sequential(jobs, async (job) => {
    if (!(await boss.getQueue(job.type))) {
      await boss.createQueue(job.type, queueOptions);
    }

    await boss.work(
      job.type,
      { includeMetadata: true, perJobResults: true },
      (batch: JobWithMetadata[]) =>
        Promise.all(
          batch.map(async (found) => {
            try {
              const outcome = await job.run(found.data);

              if (outcome && found.singletonKey !== null) {
                await boss.upsert(job.type, found.data, {
                  singletonKey: found.singletonKey,
                  startAfter: outcome.rescheduleAt,
                });
              }

              return { id: found.id, status: 'completed' as const };
            } catch (error) {
              const permanent = error instanceof PermanentError;

              log.error(
                {
                  err: error,
                  jobId: found.id,
                  jobType: job.type,
                  attempt: found.retryCount + 1,
                  permanent,
                },
                'Job failed',
              );

              return {
                id: found.id,
                status: permanent
                  ? ('deadletter' as const)
                  : ('failed' as const),
                output: {
                  message:
                    error instanceof Error ? error.message : String(error),
                },
              };
            }
          }),
        ),
    );
  });
}
