import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const jobStatus = pgEnum('job_status', [
  'pending',
  'running',
  'done',
  'failed',
  'cancelled',
]);

export const scheduledJobs = pgTable(
  'scheduled_jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    runAt: timestamp('run_at', { withTimezone: true }).notNull(),
    status: jobStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastError: text('last_error'),
    key: text('key').unique(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    index('scheduled_jobs_due_idx')
      .on(table.runAt)
      .where(sql`${table.status} = 'pending'`),
    index('scheduled_jobs_lease_idx')
      .on(table.lockedUntil)
      .where(sql`${table.status} = 'running'`),
  ],
);

export type JobRow = typeof scheduledJobs.$inferSelect;
