import { announcementView } from './message';
import { z } from 'zod';
import { channelMention } from '~/core/message';
import { parseFutureWhen } from '~/core/helpers/time';
import { ignore, PermanentError, UserError } from '~/core/errors';
import type { Actor } from '~/core/actor';
import { requireMentionable } from '~/core/helpers/roles';
import type { AnnouncementRepository, AnnouncementStatus } from './model';
import { type Authorizer } from '~/core/ports/authorization';
import { guard } from '~/core/helpers/authorization';
import type { Clock } from '~/core/ports/clock';
import type { Directory } from '~/core/ports/directory';
import type { Logger } from '~/core/ports/logger';
import type { Messenger, Sent } from '~/core/ports/messenger';
import { type Scheduler } from '~/core/ports/scheduler';
import { defineJob } from '~/core/helpers/jobs';
import { sequential } from '~/core/helpers/async';
import { visibleRecords } from '~/core/helpers/visibility';

const jobKey = (id: number) => `announcement:${id}`;
const maxLatenessMs = 60 * 60 * 1000;
const open: AnnouncementStatus[] = ['draft', 'scheduled'];

export const maxAnnouncementLength = 4000;

export interface AnnouncementDraft {
  channelId: string;
  title?: string;
  content: string;
  mentionRoleIds?: readonly string[];
}

export interface AnnouncementDeps {
  posts: AnnouncementRepository;
  scheduler: Scheduler;
  messenger: Messenger;
  directory: Directory;
  authz: Authorizer;
  log: Logger;
  clock: Clock;
  timezone: string;
}

export function createAnnouncementService(deps: AnnouncementDeps) {
  const { posts, scheduler, messenger, directory, authz, log, clock } = deps;

  const requireReadable = async (actor: Actor, id: number) => {
    const post = await posts.find(id);

    if (
      post?.guildId !== actor.guildId ||
      !(await directory.canView(actor, post.channelId)) ||
      (post.status !== 'published' &&
        post.authorId !== actor.userId &&
        !(await authz.can(actor, 'announcement:publish')))
    ) {
      throw new UserError(`Announcement #${id} does not exist.`);
    }

    return post;
  };

  const requireEditable = async (actor: Actor, id: number) => {
    const post = await requireReadable(actor, id);

    if (post.authorId !== actor.userId) {
      await authz.require(actor, 'announcement:publish');
    }

    return post;
  };

  const checkTargets = async (
    actor: Actor,
    draft: Pick<AnnouncementDraft, 'channelId' | 'mentionRoleIds'>,
  ) => {
    if (!(await directory.canPost(actor, draft.channelId))) {
      throw new UserError(
        `You cannot post in ${channelMention(draft.channelId)} yourself.`,
      );
    }

    const roles = await Promise.all(
      (draft.mentionRoleIds ?? []).map((id) =>
        directory.role(actor.guildId, id),
      ),
    );

    for (const role of roles) {
      if (!role) {
        throw new UserError('One of the mentioned roles no longer exists.');
      }

      requireMentionable(role);
    }
  };

  const publish = async (id: number, from: readonly AnnouncementStatus[]) => {
    const claimed = await posts.update(
      id,
      {
        status: 'published',
        publishedAt: clock.now(),
        failure: null,
      },
      from,
    );

    if (!claimed) {
      throw new UserError(
        `Announcement #${id} is already published or cancelled.`,
      );
    }

    const sent: Sent[] = [];

    try {
      await sequential(announcementView(claimed), async (message) => {
        sent.push(await messenger.send(claimed.channelId, message));
      });
    } catch (error) {
      await Promise.all(
        sent.map(({ messageId }) =>
          messenger.remove(claimed.channelId, messageId).catch(ignore),
        ),
      );

      const permanent =
        error instanceof PermanentError || error instanceof UserError;

      await posts.update(id, {
        status: permanent ? 'draft' : (from[0] ?? 'draft'),
        publishedAt: null,
        failure: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }

    const messageIds = sent.map(({ messageId }) => messageId);

    await posts.update(id, { messageIds });
    log.info({ announcementId: id, messageIds }, 'Announcement published');

    return { ...claimed, messageIds };
  };

  const publishJob = defineJob({
    type: 'announcements.publish',
    payload: z.object({
      announcementId: z.number().int(),
      scheduledBy: z.string().min(1).optional(),
    }),
    handle: async ({ announcementId, scheduledBy }) => {
      const post = await posts.find(announcementId);

      if (post?.status !== 'scheduled') {
        return null;
      }

      const due = post.scheduledAt ?? post.createdAt;

      const now = clock.now();

      if (due > now) {
        return { rescheduleAt: due };
      }

      if (now.getTime() - due.getTime() > maxLatenessMs) {
        await posts.update(
          announcementId,
          {
            status: 'draft',
            failure: 'Not posted: the bot was offline at the scheduled time.',
          },
          ['scheduled'],
        );
        log.warn({ announcementId }, 'Skipped stale scheduled announcement');

        return null;
      }

      const author = await directory.member(post.guildId, post.authorId);

      try {
        if (!author) {
          throw new UserError('The author is no longer a server member.');
        }

        await authz.require(author, 'announcement:create');
        const publisher =
          scheduledBy === undefined || scheduledBy === post.authorId
            ? author
            : await directory.member(post.guildId, scheduledBy);

        if (!publisher) {
          throw new UserError('The scheduler is no longer a server member.');
        }

        await authz.require(publisher, 'announcement:schedule');
        await checkTargets(author, post);
        if (publisher.userId !== post.authorId) {
          await authz.require(publisher, 'announcement:publish');
          await checkTargets(publisher, post);
        }
      } catch (error) {
        if (!(error instanceof UserError)) {
          throw error;
        }

        await posts.update(
          announcementId,
          {
            status: 'draft',
            failure: `Not posted: ${error.message}`,
          },
          ['scheduled'],
        );
        log.warn(
          { announcementId, reason: error.message },
          'Scheduled announcement authorization revoked',
        );

        return null;
      }

      await publish(announcementId, ['scheduled']);

      return null;
    },
  });

  const validate = (draft: AnnouncementDraft) => {
    if (
      draft.content.trim() === '' ||
      draft.content.length > maxAnnouncementLength
    ) {
      throw new UserError(`Write 1-${maxAnnouncementLength} characters.`);
    }
  };

  return {
    jobs: [publishJob],
    view: announcementView,
    list: async (actor: Actor) => {
      const [records, publisher] = await Promise.all([
        posts.list(actor.guildId),
        authz.can(actor, 'announcement:publish'),
      ]);
      const accessible = records.filter(
        (record) =>
          record.status === 'published' ||
          record.authorId === actor.userId ||
          publisher,
      );

      return visibleRecords(directory, actor, accessible);
    },
    get: requireReadable,
    draft: guard(
      authz,
      'announcement:create',
      async (actor, draft: AnnouncementDraft) => {
        validate(draft);
        await checkTargets(actor, draft);

        const title = draft.title?.trim() ?? '';
        const post = {
          title: title === '' ? null : title,
          content: draft.content,
          mentionRoleIds: [...(draft.mentionRoleIds ?? [])],
        };

        announcementView(post);

        return await posts.insert({
          ...post,
          guildId: actor.guildId,
          authorId: actor.userId,
          channelId: draft.channelId,
        });
      },
    ),
    edit: async (
      actor: Actor,
      id: number,
      changes: { title?: string; content: string },
    ) => {
      await authz.require(actor, 'announcement:create');
      const post = await requireEditable(actor, id);

      validate({ channelId: post.channelId, content: changes.content });

      const title = changes.title?.trim() ?? '';
      const updated = {
        ...post,
        title: title === '' ? null : title,
        content: changes.content,
      };

      const parts = announcementView(updated).map((message) => ({
        ...message,
        mentions: {},
      }));

      if (post.status !== 'published' || post.messageIds.length === 0) {
        await posts.update(id, {
          title: updated.title,
          content: updated.content,
        });

        return updated;
      }

      const messageIds: string[] = [];

      await sequential(parts.entries(), async ([index, part]) => {
        const existing = post.messageIds[index];

        if (existing === undefined) {
          const sent = await messenger.send(post.channelId, part);

          messageIds.push(sent.messageId);
        } else {
          await messenger.edit(post.channelId, existing, part);
          messageIds.push(existing);
        }
      });
      await Promise.all(
        post.messageIds
          .slice(parts.length)
          .map((messageId) => messenger.remove(post.channelId, messageId)),
      );
      await posts.update(id, {
        title: updated.title,
        content: updated.content,
        messageIds,
      });

      return { ...updated, messageIds };
    },
    publish: guard(authz, 'announcement:publish', async (actor, id: number) => {
      const post = await requireReadable(actor, id);

      await checkTargets(actor, post);
      await scheduler.cancel(publishJob, jobKey(id));

      return publish(id, open);
    }),
    schedule: guard(
      authz,
      'announcement:schedule',
      async (actor, id: number, when: string) => {
        const post = await requireReadable(actor, id);
        const runAt = parseFutureWhen(when, deps.timezone, clock.now());

        await checkTargets(actor, post);

        const scheduled = await posts.update(
          id,
          {
            status: 'scheduled',
            scheduledAt: runAt,
            failure: null,
          },
          open,
        );

        if (!scheduled) {
          throw new UserError(
            `Announcement #${id} is already published or cancelled.`,
          );
        }

        await scheduler.schedule(
          publishJob,
          { announcementId: id, scheduledBy: actor.userId },
          { runAt, key: jobKey(id) },
        );

        return scheduled;
      },
    ),
    cancel: async (actor: Actor, id: number) => {
      const post = await requireEditable(actor, id);
      const cancelled = await posts.update(
        id,
        {
          status: 'cancelled',
        },
        open,
      );

      if (!cancelled) {
        throw new UserError(`Announcement #${id} is already ${post.status}.`);
      }

      await scheduler.cancel(publishJob, jobKey(id));

      return cancelled;
    },
  };
}

export type AnnouncementService = ReturnType<typeof createAnnouncementService>;
