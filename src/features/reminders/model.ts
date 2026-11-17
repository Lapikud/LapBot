import type { Recurrence } from '~/core/helpers/time';

export type ReminderStatus = 'active' | 'done' | 'cancelled' | 'failed';

export interface Reminder {
  id: number;
  guildId: string;
  userId: string;
  channelId: string | null;
  message: string;
  runAt: Date;
  recurrence: Recurrence | null;
  timezone: string;
  status: ReminderStatus;
}

export type NewReminder = Omit<Reminder, 'id' | 'status'>;

export type ReminderChanges = Partial<
  Pick<Reminder, 'message' | 'runAt' | 'status'> & { failure: string }
>;

export interface ReminderRepository {
  insert: (reminder: NewReminder) => Promise<Reminder>;
  find: (id: number) => Promise<Reminder | undefined>;
  active: (guildId: string, userId: string) => Promise<Reminder[]>;
  update: (id: number, changes: ReminderChanges) => Promise<void>;
}
