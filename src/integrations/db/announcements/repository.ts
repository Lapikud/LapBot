import { and, desc, eq, inArray } from 'drizzle-orm';
import type { AnnouncementRepository } from '~/features/announcements/model';
import type { Db } from '../client';
import { posts } from './table';

export function createAnnouncementRepository(db: Db): AnnouncementRepository {
  return {
    insert: async (input) => {
      const [row] = await db
        .insert(posts)
        .values({ ...input, mentionRoleIds: [...(input.mentions.roles ?? [])] })
        .returning();

      if (!row) {
        throw new Error('Insert returned no row');
      }

      return row;
    },
    find: async (id) => {
      const [row] = await db.select().from(posts).where(eq(posts.id, id));

      return row;
    },
    list: async (guildId, limit = 50) => {
      return await db
        .select()
        .from(posts)
        .where(eq(posts.guildId, guildId))
        .orderBy(desc(posts.id))
        .limit(limit);
    },
    update: async (id, changes, onlyIf) => {
      const [row] = await db
        .update(posts)
        .set({
          ...changes,
          ...(changes.mentions && {
            mentionRoleIds: [...(changes.mentions.roles ?? [])],
          }),
        })
        .where(
          and(eq(posts.id, id), onlyIf && inArray(posts.status, [...onlyIf])),
        )
        .returning();

      return row;
    },
  };
}
