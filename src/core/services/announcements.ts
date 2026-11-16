import { z } from 'zod';
import {
  channelMention,
  maxContentLength,
  parseFutureWhen,
  PermanentError,
  requireMentionable,
  roleMention,
  UserError,
  type Actor,
  type Message,
} from '~/domain';
import type {
  Announcement,
  AnnouncementRepository,
  AnnouncementStatus,
  Authorizer,
  Clock,
  Directory,
  Logger,
  Messenger,
  Scheduler,
} from '~/core/ports';
import { guard } from './guard';
import { defineJob } from './jobs';

const jobKey = (id: number) => `announcement:${id}`;
const maxLatenessMs = 60 * 60 * 1000;
const reopenable: AnnouncementStatus[] = ['draft', 'scheduled', 'failed'];

export const maxAnnouncementLength = 1900;

export type AnnouncementDraft = {
  channelId: string;
  title?: string;
  content: string;
  mentionRoleIds?: readonly string[];
  mentionEveryone?: boolean;
};

export function announcementView(announcement: Announcement): Message {
  const pings = [
    ...(announcement.mentionEveryone ? ['@everyone'] : []),
    ...announcement.mentionRoleIds.map((id) => roleMention(id)),
  ].join(' ');
  const mentions = {
    everyone: announcement.mentionEveryone,
    roles: announcement.mentionRoleIds,
  };

  const heading =
    announcement.title === null ? '' : `# ${announcement.title}\n`;
  const content = [pings, `${heading}${announcement.content}`]
    .filter(Boolean)
    .join('\n');

  if (content.length > maxContentLength) {
    throw new UserError(
      'Announcements are limited to 2000 characters, including the title and mentions.',
    );
  }

  return { content, mentions };
}

type Deps = {
  announcements: AnnouncementRepository;
  scheduler: Scheduler;
  messenger: Messenger;
  directory: Directory;
  authz: Authorizer;
  log: Logger;
  clock: Clock;
  timezone: string;
};

export function createAnnouncementService(deps: Deps) {
  const { announcements, scheduler, messenger, directory, authz, log, clock } =
    deps;

  const requireOwnGuild = async (actor: Actor, id: number) => {
    const announcement = await announcements.find(id);

    if (announcement?.guildId !== actor.guildId) {
      throw new UserError(`Announcement #${id} does not exist.`);
    }

    return announcement;
  };

  const requireEditable = async (actor: Actor, id: number) => {
    const announcement = await requireOwnGuild(actor, id);

    if (announcement.authorId !== actor.userId) {
      await authz.require(actor, 'announcement:publish');
    }

    return announcement;
  };

  const checkTargets = async (
    actor: Actor,
    draft: Pick<
      AnnouncementDraft,
      'channelId' | 'mentionRoleIds' | 'mentionEveryone'
    >,
  ) => {
    if (!(await directory.canPost(actor, draft.channelId))) {
      throw new UserError(
        `You cannot post in ${channelMention(draft.channelId)} yourself.`,
      );
    }

    if (draft.mentionEveryone === true && !actor.mentionEveryone) {
      throw new UserError('You may not mention everyone.');
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

      requireMentionable(actor, role);
    }
  };

  const publish = async (id: number, from: readonly AnnouncementStatus[]) => {
    const claimed = await announcements.transition(id, from, {
      status: 'publishing',
    });

    if (!claimed) {
      throw new UserError(
        `Announcement #${id} cannot be published in its current state.`,
      );
    }

    try {
      const sent = await messenger.send(
        claimed.channelId,
        announcementView(claimed),
      );
      const published = await announcements.transition(id, ['publishing'], {
        status: 'published',
        publishedAt: clock.now(),
        messageId: sent.messageId,
        failure: null,
      });

      log.info(
        { announcementId: id, messageId: sent.messageId },
        'Announcement published',
      );

      return published ?? claimed;
    } catch (error) {
      const permanent =
        error instanceof PermanentError || error instanceof UserError;
      const message = error instanceof Error ? error.message : String(error);

      await announcements.transition(id, ['publishing'], {
        status: permanent ? 'failed' : (from[0] ?? 'draft'),
        failure: message,
      });

      throw error;
    }
  };

  const publishJob = defineJob({
    type: 'announcements:publish',
    payload: z.object({ announcementId: z.number().int() }),
    handle: async ({ announcementId }) => {
      const announcement = await announcements.find(announcementId);

      if (announcement?.status !== 'scheduled') {
        return;
      }

      const due = announcement.scheduledAt ?? announcement.createdAt;

      if (clock.now().getTime() - due.getTime() > maxLatenessMs) {
        await announcements.transition(announcementId, ['scheduled'], {
          status: 'failed',
          failure:
            'Skipped: the scheduled time passed while the bot was offline',
        });
        log.warn({ announcementId }, 'Skipped stale scheduled announcement');

        return;
      }

      await publish(announcementId, ['scheduled']);
    },
  });

  const validate = (draft: AnnouncementDraft) => {
    if (
      draft.content.trim() === '' ||
      draft.content.length > maxAnnouncementLength
    ) {
      throw new UserError(`Write 1–${maxAnnouncementLength} characters.`);
    }
  };

  return {
    jobs: [publishJob],
    view: announcementView,
    list: (guildId: string) => announcements.list(guildId),
    get: requireOwnGuild,
    draft: guard(
      authz,
      'announcement:create',
      async (actor, draft: AnnouncementDraft) => {
        validate(draft);
        await checkTargets(actor, draft);

        const title = draft.title?.trim() ?? '';
        const created = await announcements.insert({
          guildId: actor.guildId,
          authorId: actor.userId,
          channelId: draft.channelId,
          title: title === '' ? null : title,
          content: draft.content,
          mentionRoleIds: [...(draft.mentionRoleIds ?? [])],
          mentionEveryone: draft.mentionEveryone ?? false,
        });

        announcementView(created);

        return created;
      },
    ),
    edit: async (
      actor: Actor,
      id: number,
      changes: { title?: string; content: string },
    ) => {
      const announcement = await requireEditable(actor, id);

      validate({ channelId: announcement.channelId, content: changes.content });

      const title = changes.title?.trim() ?? '';
      const updated = {
        ...announcement,
        title: title === '' ? null : title,
        content: changes.content,
      };

      announcementView(updated);
      await announcements.update(id, {
        title: updated.title,
        content: updated.content,
      });

      if (
        announcement.status === 'published' &&
        announcement.messageId !== null
      ) {
        await messenger.edit(announcement.channelId, announcement.messageId, {
          ...announcementView(updated),
          mentions: {},
        });
      }

      return updated;
    },
    publish: guard(authz, 'announcement:publish', async (actor, id: number) => {
      await requireOwnGuild(actor, id);
      await scheduler.cancel(publishJob, jobKey(id));

      return publish(id, reopenable);
    }),
    schedule: guard(
      authz,
      'announcement:schedule',
      async (actor, id: number, when: string) => {
        const announcement = await requireOwnGuild(actor, id);
        const runAt = parseFutureWhen(when, deps.timezone, clock.now());

        await checkTargets(actor, announcement);

        const scheduled = await announcements.transition(id, reopenable, {
          status: 'scheduled',
          scheduledAt: runAt,
          failure: null,
        });

        if (!scheduled) {
          throw new UserError(
            `Announcement #${id} cannot be scheduled in its current state.`,
          );
        }

        await scheduler.schedule(
          publishJob,
          { announcementId: id },
          { runAt, key: jobKey(id) },
        );

        return scheduled;
      },
    ),
    cancel: async (actor: Actor, id: number) => {
      const announcement = await requireEditable(actor, id);
      const cancelled = await announcements.transition(id, reopenable, {
        status: 'cancelled',
      });

      if (!cancelled) {
        throw new UserError(
          `Announcement #${id} is already ${announcement.status}.`,
        );
      }

      await scheduler.cancel(publishJob, jobKey(id));

      return cancelled;
    },
  };
}

export type AnnouncementService = ReturnType<typeof createAnnouncementService>;
