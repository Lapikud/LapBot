import { and, asc, count, eq } from 'drizzle-orm';
import type { Db } from '../client';
import { UserError } from '~/core/errors';
import type {
  NewReminder,
  ReminderRepository,
} from '~/features/reminders/model';
import { reminders, type Reminder } from './table';

export const maxActivePerUser = 25;
export const maxMessageLength = 1000;

export async function insertReminder(
  db: Db,
  input: NewReminder,
): Promise<Reminder> {
  if (input.message.length > maxMessageLength) {
    throw new UserError(
      `Reminders can be at most ${maxMessageLength} characters.`,
    );
  }

  return await db.transaction(async (tx) => {
    const [active] = await tx
      .select({ total: count() })
      .from(reminders)
      .where(
        and(
          eq(reminders.guildId, input.guildId),
          eq(reminders.userId, input.userId),
          eq(reminders.status, 'active'),
        ),
      );

    if ((active?.total ?? 0) >= maxActivePerUser) {
      throw new UserError(
        `You can have at most ${maxActivePerUser} active reminders.`,
      );
    }

    const [row] = await tx.insert(reminders).values(input).returning();

    if (!row) {
      throw new Error('Insert returned no row');
    }

    return row;
  });
}

export async function getReminder(
  db: Db,
  id: number,
): Promise<Reminder | undefined> {
  const [row] = await db.select().from(reminders).where(eq(reminders.id, id));

  return row;
}

export async function listActiveReminders(
  db: Db,
  guildId: string,
  userId: string,
): Promise<Reminder[]> {
  return await db
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.guildId, guildId),
        eq(reminders.userId, userId),
        eq(reminders.status, 'active'),
      ),
    )
    .orderBy(asc(reminders.runAt))
    .limit(maxActivePerUser);
}

export async function updateReminder(
  db: Db,
  id: number,
  changes: Partial<Pick<Reminder, 'message' | 'runAt' | 'status' | 'failure'>>,
): Promise<void> {
  await db.update(reminders).set(changes).where(eq(reminders.id, id));
}

export function createReminderRepository(db: Db): ReminderRepository {
  return {
    insert: (reminder) => insertReminder(db, reminder),
    find: (id) => getReminder(db, id),
    active: (guildId, userId) => listActiveReminders(db, guildId, userId),
    update: (id, changes) => updateReminder(db, id, changes),
  };
}
