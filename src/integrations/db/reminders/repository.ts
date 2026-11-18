import { and, asc, count, eq } from 'drizzle-orm';
import type { Db } from '../client';
import { UserError } from '~/core/errors';
import type { ReminderRepository } from '~/features/reminders/model';
import { reminders } from './table';

export const maxActivePerUser = 25;
export const maxMessageLength = 1000;

export function createReminderRepository(db: Db): ReminderRepository {
  return {
    insert: async (input) => {
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
    },
    find: async (id) => {
      const [row] = await db
        .select()
        .from(reminders)
        .where(eq(reminders.id, id));

      return row;
    },
    active: async (guildId, userId) => {
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
    },
    update: async (id, changes) => {
      await db.update(reminders).set(changes).where(eq(reminders.id, id));
    },
  };
}
