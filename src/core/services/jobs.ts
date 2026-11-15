import type { z } from 'zod';
import { PermanentError } from '~/domain';
import type { Job, JobInfo, JobOutcome } from '~/core/ports';

export function defineJob<S extends z.ZodType>(definition: {
  type: string;
  payload: S;
  maxAttempts?: number;
  handle: (
    payload: z.infer<S>,
    info: JobInfo,
  ) => Promise<JobOutcome | undefined>;
}): Job<z.infer<S>> {
  return {
    type: definition.type,
    maxAttempts: definition.maxAttempts ?? 5,
    run: async (raw, info) => {
      const parsed = definition.payload.safeParse(raw);

      if (!parsed.success) {
        throw new PermanentError(`Invalid payload: ${parsed.error.message}`);
      }

      return (await definition.handle(parsed.data, info)) ?? null;
    },
  };
}
