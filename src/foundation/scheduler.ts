import type { z } from 'zod';
import { PermanentError } from './errors';

export type JobOutcome = null | { rescheduleAt: Date };

export type Job<P> = {
  type: string;
  run: (raw: unknown) => Promise<JobOutcome>;
  payloadType?: P;
};

export type ScheduleOptions = { runAt: Date; key: string };

export type Scheduler = {
  schedule: <P extends object>(
    job: Job<P>,
    payload: P,
    options: ScheduleOptions,
  ) => Promise<void>;
  cancel: <P>(job: Job<P>, key: string) => Promise<void>;
};

export function defineJob<S extends z.ZodType>(definition: {
  type: string;
  payload: S;
  handle: (payload: z.infer<S>) => Promise<JobOutcome | undefined>;
}): Job<z.infer<S>> {
  return {
    type: definition.type,
    run: async (raw) => {
      const parsed = definition.payload.safeParse(raw);

      if (!parsed.success) {
        throw new PermanentError(`Invalid payload: ${parsed.error.message}`);
      }

      return (await definition.handle(parsed.data)) ?? null;
    },
  };
}
