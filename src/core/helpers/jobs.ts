import type { z } from 'zod';
import { PermanentError } from '~/core/errors';
import type { Job, JobOutcome } from '~/core/ports/scheduler';

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
