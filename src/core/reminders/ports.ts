import type {
  Reminder,
  NewReminder,
  ReminderChanges,
} from '~/domain/reminders';
export type ReminderRepository = {
  insert: (reminder: NewReminder) => Promise<Reminder>;
  find: (id: number) => Promise<Reminder | undefined>;
  active: (guildId: string, userId: string) => Promise<Reminder[]>;
  update: (id: number, changes: ReminderChanges) => Promise<void>;
};
