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
  Sent,
} from '~/core/ports';
import { guard } from './guard';
import { defineJob } from './jobs';

const jobKey = (id: number) => `announcement:${id}`;
const maxLatenessMs = 60 * 60 * 1000;
const open: AnnouncementStatus[] = ['draft', 'scheduled'];

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

  const requireReadable = async (actor: Actor, id: number) => {
    const announcement = await announcements.find(id);

    if (
      announcement?.guildId !== actor.guildId ||
      !(await directory.canView(actor, announcement.channelId)) ||
      (announcement.status !== 'published' &&
        announcement.authorId !== actor.userId &&
        !(await authz.can(actor, 'announcement:publish')))
    ) {
      throw new UserError(`Announcement #${id} does not exist.`);
    }

    return announcement;
  };

  const requireEditable = async (actor: Actor, id: number) => {
    const announcement = await requireReadable(actor, id);

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
    const claimed = await announcements.update(
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

    let sent: Sent;

    try {
      sent = await messenger.send(claimed.channelId, announcementView(claimed));
    } catch (error) {
      const permanent =
        error instanceof PermanentError || error instanceof UserError;

      await announcements.update(id, {
        status: permanent ? 'draft' : (from[0] ?? 'draft'),
        publishedAt: null,
        failure: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }

    const { messageId } = sent;

    await announcements.update(id, { messageId });
    log.info({ announcementId: id, messageId }, 'Announcement published');

    return { ...claimed, messageId };
  };

  const publishJob = defineJob({
    type: 'announcements.publish',
    payload: z.object({ announcementId: z.number().int() }),
    handle: async ({ announcementId }) => {
      const announcement = await announcements.find(announcementId);

      if (announcement?.status !== 'scheduled') {
        return;
      }

      const due = announcement.scheduledAt ?? announcement.createdAt;

      if (clock.now().getTime() - due.getTime() > maxLatenessMs) {
        await announcements.update(
          announcementId,
          {
            status: 'draft',
            failure: 'Not posted: the bot was offline at the scheduled time.',
          },
          ['scheduled'],
        );
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
    list: async (actor: Actor) => {
      const [records, publisher] = await Promise.all([
        announcements.list(actor.guildId),
        authz.can(actor, 'announcement:publish'),
      ]);
      const accessible = records.filter(
        (record) =>
          record.status === 'published' ||
          record.authorId === actor.userId ||
          publisher,
      );
      const channels = [
        ...new Set(accessible.map((record) => record.channelId)),
      ];
      const allowed = await Promise.all(
        channels.map(async (id) =>
          (await directory.canView(actor, id)) ? [id] : [],
        ),
      );
      const visible = new Set(allowed.flat());

      return accessible.filter((record) => visible.has(record.channelId));
    },
    get: requireReadable,
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
      const announcement = await requireReadable(actor, id);

      await checkTargets(actor, announcement);
      await scheduler.cancel(publishJob, jobKey(id));

      return publish(id, open);
    }),
    schedule: guard(
      authz,
      'announcement:schedule',
      async (actor, id: number, when: string) => {
        const announcement = await requireReadable(actor, id);
        const runAt = parseFutureWhen(when, deps.timezone, clock.now());

        await checkTargets(actor, announcement);

        const scheduled = await announcements.update(
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
          { announcementId: id },
          { runAt, key: jobKey(id) },
        );

        return scheduled;
      },
    ),
    cancel: async (actor: Actor, id: number) => {
      const announcement = await requireEditable(actor, id);
      const cancelled = await announcements.update(
        id,
        {
          status: 'cancelled',
        },
        open,
      );

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
