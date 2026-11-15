import { and, asc, eq, inArray, lte, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { scheduledJobs, type JobRow } from './model';

export type NewJob = {
  type: string;
  payload: unknown;
  runAt: Date;
  key?: string | undefined;
  maxAttempts?: number | undefined;
};

export async function upsertJob(db: Db, job: NewJob): Promise<void> {
  const values = {
    type: job.type,
    payload: job.payload,
    runAt: job.runAt,
    key: job.key ?? null,
    maxAttempts: job.maxAttempts ?? 5,
  };

  await db
    .insert(scheduledJobs)
    .values(values)
    .onConflictDoUpdate({
      target: scheduledJobs.key,
      set: {
        ...values,
        status: 'pending',
        attempts: 0,
        lockedUntil: null,
        lastError: null,
        finishedAt: null,
      },
    });
}

export async function cancelJob(db: Db, key: string): Promise<void> {
  await db
    .update(scheduledJobs)
    .set({ status: 'cancelled', finishedAt: new Date(), lockedUntil: null })
    .where(
      and(
        eq(scheduledJobs.key, key),
        inArray(scheduledJobs.status, ['pending', 'running']),
      ),
    );
}

export async function claimDueJobs(
  db: Db,
  options: { types: readonly string[]; limit: number; leaseMs: number },
): Promise<JobRow[]> {
  if (options.types.length === 0) {
    return [];
  }

  const due = db
    .select({ id: scheduledJobs.id })
    .from(scheduledJobs)
    .where(
      and(
        inArray(scheduledJobs.type, [...options.types]),
        or(
          and(
            eq(scheduledJobs.status, 'pending'),
            lte(scheduledJobs.runAt, sql`now()`),
          ),
          and(
            eq(scheduledJobs.status, 'running'),
            lt(scheduledJobs.lockedUntil, sql`now()`),
          ),
        ),
      ),
    )
    .orderBy(asc(scheduledJobs.runAt))
    .limit(options.limit)
    .for('update', { skipLocked: true });

  return db
    .update(scheduledJobs)
    .set({
      status: 'running',
      attempts: sql`${scheduledJobs.attempts} + 1`,
      lockedUntil: sql`now() + ${options.leaseMs} * interval '1 millisecond'`,
    })
    .where(inArray(scheduledJobs.id, due))
    .returning();
}

type Finish =
  | { kind: 'done' }
  | { kind: 'reschedule'; runAt: Date }
  | { kind: 'retry'; runAt: Date; error: string }
  | { kind: 'failed'; error: string };

export async function finishJob(
  db: Db,
  id: number,
  finish: Finish,
): Promise<void> {
  const now = new Date();
  const changes = {
    done: { status: 'done', finishedAt: now },
    reschedule: { status: 'pending', attempts: 0, lastError: null },
    retry: { status: 'pending' },
    failed: { status: 'failed', finishedAt: now },
  } as const;

  await db
    .update(scheduledJobs)
    .set({
      ...changes[finish.kind],
      lockedUntil: null,
      ...('runAt' in finish && { runAt: finish.runAt }),
      ...('error' in finish && { lastError: finish.error.slice(0, 2000) }),
    })
    .where(and(eq(scheduledJobs.id, id), eq(scheduledJobs.status, 'running')));
}
