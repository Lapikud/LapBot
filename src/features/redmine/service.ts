import { and, asc, eq, gt } from 'drizzle-orm';
import type { Db } from '~/infra/db';
import type { RedmineIssue, RedmineStatus } from '~/infra/redmine';
import {
  redmineLinks,
  redmineNotifications,
  redmineSubscriptions,
  type RedmineLink,
} from './schema';

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

export type Notification = { key: string; text: string };

export function issueNotifications(
  issue: RedmineIssue,
  since: Date,
  statuses: ReadonlyMap<number, RedmineStatus>,
  issueUrl: string,
): Notification[] {
  if (issue.is_private === true) {
    return [];
  }

  const title = `[#${issue.id}](${issueUrl}) ${issue.subject}`;
  const notifications: Notification[] = [];

  if (new Date(issue.created_on) >= since) {
    const assignee = issue.assigned_to
      ? `, assigned to ${issue.assigned_to.name}`
      : '';

    notifications.push({
      key: `issue:${issue.id}:created`,
      text: `🆕 ${issue.tracker.name} ${title} by ${issue.author.name}${assignee}`,
    });
  }

  for (const journal of issue.journals ?? []) {
    if (
      new Date(journal.created_on) < since ||
      journal.private_notes === true
    ) {
      continue;
    }

    const changes = journal.details.flatMap((detail) => {
      if (detail.property !== 'attr') {
        return [];
      }

      if (detail.name === 'status_id') {
        const name = (id: string | null | undefined) =>
          statuses.get(Number(id))?.name ?? '?';

        return [`status ${name(detail.old_value)} → ${name(detail.new_value)}`];
      }

      if (detail.name === 'assigned_to_id') {
        const matches =
          issue.assigned_to &&
          String(issue.assigned_to.id) === detail.new_value;

        return [
          matches === true
            ? `assigned to ${issue.assigned_to?.name ?? ''}`
            : 'assignee changed',
        ];
      }

      return [];
    });
    const notes = journal.notes?.trim() ?? '';

    if (changes.length === 0 && notes === '') {
      continue;
    }

    const who = journal.user?.name ?? 'Someone';
    const comment =
      notes === '' ? '' : `\n> ${notes.slice(0, 300).replaceAll('\n', '\n> ')}`;

    notifications.push({
      key: `journal:${journal.id}`,
      text: `✏️ ${title}: ${[who, ...changes].join(' · ')}${comment}`,
    });
  }

  return notifications;
}
