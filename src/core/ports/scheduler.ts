export type JobOutcome = null | { rescheduleAt: Date };

export interface Job<P> {
  type: string;
  run: (raw: unknown) => Promise<JobOutcome>;
  payloadType?: P;
}

export interface ScheduleOptions {
  runAt: Date;
  key: string;
}

export interface Scheduler {
  schedule: <P extends object>(
    job: Job<P>,
    payload: P,
    options: ScheduleOptions,
  ) => Promise<void>;
  cancel: <P>(job: Job<P>, key: string) => Promise<void>;
}
