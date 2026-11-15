import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { UserError } from '../../shared/errors.js';
import { announcements, type Announcement } from './schema.js';

type Status = Announcement['status'];

export async function insertAnnouncement(
  db: Db,
  input: Pick<
    Announcement,
    | 'guildId'
    | 'authorId'
    | 'channelId'
    | 'title'
    | 'content'
    | 'embed'
    | 'mentionRoleId'
  >,
): Promise<Announcement> {
  const [row] = await db.insert(announcements).values(input).returning();
  if (!row) {
    throw new Error('Insert returned no row');
  }
  return row;
}

export async function requireAnnouncement(
  db: Db,
  guildId: string,
  id: number,
): Promise<Announcement> {
  const [row] = await db
    .select()
    .from(announcements)
    .where(and(eq(announcements.id, id), eq(announcements.guildId, guildId)));
  if (!row) {
    throw new UserError(`Announcement #${id} does not exist.`);
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

export async function listAnnouncements(db: Db, guildId: string) {
  return db
    .select({
      id: announcements.id,
      title: announcements.title,
      content: announcements.content,
      status: announcements.status,
    })
    .from(announcements)
    .where(
      and(
        eq(announcements.guildId, guildId),
        inArray(announcements.status, ['draft', 'scheduled']),
      ),
    )
    .orderBy(desc(announcements.id))
    .limit(25);
}

/**
 * Moves an announcement between states only if it is currently in one of
 * `from`. Publishing claims the row this way first, so concurrent publish
 * attempts cannot post it twice.
 */
export async function transition(
  db: Db,
  id: number,
  from: readonly Status[],
  changes: Partial<Announcement> & { status: Status },
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
  changes: Pick<Announcement, 'title' | 'content'>,
): Promise<void> {
  await db.update(announcements).set(changes).where(eq(announcements.id, id));
}
