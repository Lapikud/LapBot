import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../client';
import type { EventSuggestionRepository } from '~/features/event-suggestions/model';
import { UserError } from '~/core/errors';
import { eventSuggestions } from './table';
export function createEventSuggestionRepository(
  db: Db,
): EventSuggestionRepository {
  return {
    insert: async (input) => {
      const [row] = await db.insert(eventSuggestions).values(input).returning();

      if (!row) {
        throw new Error('Insert returned no suggestion');
      }

      return row;
    },
    list: async (guildId, offset, limit) =>
      db
        .select()
        .from(eventSuggestions)
        .where(eq(eventSuggestions.guildId, guildId))
        .orderBy(desc(eventSuggestions.id))
        .offset(offset)
        .limit(limit),
    update: async (guildId, id, changes) => {
      const [row] = await db
        .update(eventSuggestions)
        .set(changes)
        .where(
          and(
            eq(eventSuggestions.guildId, guildId),
            eq(eventSuggestions.id, id),
          ),
        )
        .returning();

      if (!row) {
        throw new UserError('Suggestion not found.');
      }

      return row;
    },
  };
}
