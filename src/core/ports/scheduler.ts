export type JobInfo = { id: number; runAt: Date; attempt: number };

export type JobOutcome = null | { rescheduleAt: Date };

export type Job<P> = {
  type: string;
  maxAttempts: number;
  run: (raw: unknown, info: JobInfo) => Promise<JobOutcome>;
  payloadType?: P;
};

export type ScheduleOptions = {
  runAt: Date;
  key?: string;
  maxAttempts?: number;
};

export type Scheduler = {
  schedule: <P>(
    job: Job<P>,
    payload: P,
    options: ScheduleOptions,
  ) => Promise<void>;
  cancel: (key: string) => Promise<void>;
};
