import type { Scheduler } from '~/core/ports';
import { cancelJob, upsertJob, type Db } from '~/infra/db';

export function createJobQueue(db: Db): Scheduler {
  return {
    schedule: async (job, payload, options) => {
      await upsertJob(db, {
        type: job.type,
        payload,
        runAt: options.runAt,
        key: options.key,
        maxAttempts: options.maxAttempts ?? job.maxAttempts,
      });
    },
    cancel: (key) => cancelJob(db, key),
  };
}
