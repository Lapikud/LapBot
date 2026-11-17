import type { Recurrence } from '~/domain';

export type ReminderStatus = 'active' | 'done' | 'cancelled' | 'failed';

export type Reminder = {
  id: number;
  guildId: string;
  userId: string;
  channelId: string | null;
  message: string;
  runAt: Date;
  recurrence: Recurrence | null;
  timezone: string;
  status: ReminderStatus;
};

export type NewReminder = Omit<Reminder, 'id' | 'status'>;

export type ReminderChanges = Partial<
  Pick<Reminder, 'message' | 'runAt' | 'status'> & { failure: string }
>;
