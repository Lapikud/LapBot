import { and, desc, eq, inArray } from 'drizzle-orm';
import type {
  AnnouncementChanges,
  NewAnnouncement,
  AnnouncementRepository,
} from '~/features/announcements/model';
import type { Db } from '../client';
import { posts, type AnnouncementRow } from './table';

type Status = AnnouncementRow['status'];

export async function insertAnnouncement(
  db: Db,
  input: NewAnnouncement,
): Promise<AnnouncementRow> {
  const [row] = await db.insert(posts).values(input).returning();

  if (!row) {
    throw new Error('Insert returned no row');
  }

  return row;
}

export async function getAnnouncement(
  db: Db,
  id: number,
): Promise<AnnouncementRow | undefined> {
  const [row] = await db.select().from(posts).where(eq(posts.id, id));

  return row;
}

export async function listAnnouncements(
  db: Db,
  guildId: string,
  limit = 50,
): Promise<AnnouncementRow[]> {
  return await db
    .select()
    .from(posts)
    .where(eq(posts.guildId, guildId))
    .orderBy(desc(posts.id))
    .limit(limit);
}

export async function updateAnnouncement(
  db: Db,
  id: number,
  changes: AnnouncementChanges,
  onlyIf?: readonly Status[],
): Promise<AnnouncementRow | undefined> {
  const [row] = await db
    .update(posts)
    .set(changes)
    .where(and(eq(posts.id, id), onlyIf && inArray(posts.status, [...onlyIf])))
    .returning();

  return row;
}

export function createAnnouncementRepository(db: Db): AnnouncementRepository {
  return {
    insert: (post) => insertAnnouncement(db, post),
    find: (id) => getAnnouncement(db, id),
    list: (guildId, limit) => listAnnouncements(db, guildId, limit),
    update: (id, changes, onlyIf) =>
      updateAnnouncement(db, id, changes, onlyIf),
  };
}
