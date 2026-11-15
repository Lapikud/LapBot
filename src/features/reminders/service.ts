import { and, asc, count, eq } from 'drizzle-orm';
import type { Db } from '~/infra/db';
import { UserError } from '~/domain';
import type { Recurrence } from '~/domain';
import { reminders, type Reminder } from './schema';

export const maxActivePerUser = 25;
export const maxMessageLength = 1000;

export type NewReminder = {
  guildId: string;
  userId: string;
  channelId: string | null;
  message: string;
  runAt: Date;
  recurrence: Recurrence | null;
  timezone: string;
};

export async function insertReminder(
  db: Db,
  input: NewReminder,
): Promise<Reminder> {
  if (input.message.length > maxMessageLength) {
    throw new UserError(
      `Reminders can be at most ${maxMessageLength} characters.`,
    );
  }

  return db.transaction(async (tx) => {
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
  return db
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

export async function requireOwnReminder(
  db: Db,
  guildId: string,
  userId: string,
  id: number,
): Promise<Reminder> {
  const reminder = await getReminder(db, id);

  if (
    reminder?.guildId !== guildId ||
    reminder.userId !== userId ||
    reminder.status !== 'active'
  ) {
    throw new UserError(`You have no active reminder #${id}.`);
  }

  return reminder;
}
