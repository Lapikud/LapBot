import { and, asc, eq, gt } from 'drizzle-orm';
import type { TrackerRepository } from '~/core/ports';
import type { Db } from '../client';
import {
  redmineLinks,
  redmineNotifications,
  redmineSubscriptions,
  type RedmineLink,
} from './model';

export async function saveLink(
  db: Db,
  link: Omit<RedmineLink, 'linkedAt'>,
): Promise<void> {
  await db
    .insert(redmineLinks)
    .values(link)
    .onConflictDoUpdate({
      target: redmineLinks.userId,
      set: { ...link, linkedAt: new Date() },
    });
}

export async function getLink(
  db: Db,
  userId: string,
): Promise<RedmineLink | undefined> {
  const [row] = await db
    .select()
    .from(redmineLinks)
    .where(eq(redmineLinks.userId, userId));

  return row;
}

export async function deleteLink(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .delete(redmineLinks)
    .where(eq(redmineLinks.userId, userId))
    .returning({ userId: redmineLinks.userId });

  return rows.length > 0;
}

export async function addSubscription(
  db: Db,
  input: typeof redmineSubscriptions.$inferInsert,
): Promise<boolean> {
  const rows = await db
    .insert(redmineSubscriptions)
    .values(input)
    .onConflictDoNothing()
    .returning({ id: redmineSubscriptions.id });

  return rows.length > 0;
}

export async function removeSubscription(
  db: Db,
  guildId: string,
  channelId: string,
  projectId: number,
): Promise<boolean> {
  const rows = await db
    .delete(redmineSubscriptions)
    .where(
      and(
        eq(redmineSubscriptions.guildId, guildId),
        eq(redmineSubscriptions.channelId, channelId),
        eq(redmineSubscriptions.projectId, projectId),
      ),
    )
    .returning({ id: redmineSubscriptions.id });

  return rows.length > 0;
}

export async function listSubscriptions(db: Db, afterId = 0, limit = 50) {
  return db
    .select()
    .from(redmineSubscriptions)
    .where(gt(redmineSubscriptions.id, afterId))
    .orderBy(asc(redmineSubscriptions.id))
    .limit(limit);
}

export async function setCheckpoint(
  db: Db,
  id: number,
  checkpoint: Date,
): Promise<void> {
  await db
    .update(redmineSubscriptions)
    .set({ checkpoint })
    .where(eq(redmineSubscriptions.id, id));
}

export async function claimNotification(
  db: Db,
  subscriptionId: number,
  key: string,
): Promise<boolean> {
  const rows = await db
    .insert(redmineNotifications)
    .values({ subscriptionId, key })
    .onConflictDoNothing()
    .returning({ key: redmineNotifications.key });

  return rows.length > 0;
}

export function createTrackerRepository(db: Db): TrackerRepository {
  return {
    saveLink: (link) => saveLink(db, link),
    link: (userId) => getLink(db, userId),
    unlink: (userId) => deleteLink(db, userId),
    subscribe: (subscription) => addSubscription(db, subscription),
    unsubscribe: (guildId, channelId, projectId) =>
      removeSubscription(db, guildId, channelId, projectId),
    subscriptions: (afterId, limit) => listSubscriptions(db, afterId, limit),
    setCheckpoint: (id, checkpoint) => setCheckpoint(db, id, checkpoint),
    claimNotification: (subscriptionId, key) =>
      claimNotification(db, subscriptionId, key),
  };
}
