import { and, desc, eq, inArray } from 'drizzle-orm';
import type {
  AnnouncementChanges,
  AnnouncementRepository,
  NewAnnouncement,
} from '~/core/ports';
import type { Db } from '../client';
import { announcements, type Announcement } from './model';

type Status = Announcement['status'];

export async function insertAnnouncement(
  db: Db,
  input: NewAnnouncement,
): Promise<Announcement> {
  const [row] = await db.insert(announcements).values(input).returning();

  if (!row) {
    throw new Error('Insert returned no row');
  }

  return row;
}

export async function getAnnouncement(
  db: Db,
  id: number,
): Promise<Announcement | undefined> {
  const [row] = await db
    .select()
    .from(announcements)
    .where(eq(announcements.id, id));

  return row;
}

export async function listAnnouncements(
  db: Db,
  guildId: string,
  limit = 50,
): Promise<Announcement[]> {
  return db
    .select()
    .from(announcements)
    .where(eq(announcements.guildId, guildId))
    .orderBy(desc(announcements.id))
    .limit(limit);
}

export async function transition(
  db: Db,
  id: number,
  from: readonly Status[],
  changes: AnnouncementChanges,
): Promise<Announcement | undefined> {
  const [row] = await db
    .update(announcements)
    .set(changes)
    .where(
      and(eq(announcements.id, id), inArray(announcements.status, [...from])),
    )
    .returning();

  return row;
}

export async function updateContent(
  db: Db,
  id: number,
  changes: Parameters<AnnouncementRepository['update']>[1],
): Promise<void> {
  await db.update(announcements).set(changes).where(eq(announcements.id, id));
}

export function createAnnouncementRepository(db: Db): AnnouncementRepository {
  return {
    insert: (announcement) => insertAnnouncement(db, announcement),
    find: (id) => getAnnouncement(db, id),
    list: (guildId, limit) => listAnnouncements(db, guildId, limit),
    transition: (id, from, changes) => transition(db, id, from, changes),
    update: (id, changes) => updateContent(db, id, changes),
  };
}
