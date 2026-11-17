import { eventCalendarEntry } from './calendar';
import { eventView, reminderText } from './message';
import { z } from 'zod';
import { channelMention, maxContentLength, roleMention } from '~/core/message';
import { parseFutureWhen, parseWhen } from '~/core/helpers/time';
import { UserError } from '~/core/errors';
import type { Actor } from '~/core/actor';
import { requireMentionable } from '~/core/helpers/roles';
import type { Authorizer } from '~/core/ports/authorization';
import type { Calendar } from '~/core/ports/calendar';
import type { Directory } from '~/core/ports/directory';
import type { Logger } from '~/core/ports/logger';
import type { Messenger } from '~/core/ports/messenger';
import { type Scheduler } from '~/core/ports/scheduler';
import { defineJob } from '~/core/helpers/jobs';
import type { Event, NewEvent, RsvpStatus, EventRepository } from './model';

const maxReminders = 3;
const reminderKey = (id: number, minutes: number) =>
  `event:${id}:remind:${minutes}`;

export interface EventRequest {
  title: string;
  start: string;
  end?: string;
  description?: string;
  location?: string;
  channelId: string;
  capacity?: number;
  mentionRoleId?: string;
  reminders?: string;
  native?: boolean;
  icons?: boolean;
}

export interface EventChanges extends Partial<
  Pick<EventRequest, 'title' | 'start' | 'icons'>
> {
  end?: string | null;
  description?: string | null;
  location?: string | null;
  capacity?: number | null;
}

const maxTitleLength = 200;
const maxDescriptionLength = 1500;

function requireText(title: string, description?: string | null) {
  if (title.trim() === '' || title.length > maxTitleLength) {
    throw new UserError(`Give a title of 1-${maxTitleLength} characters.`);
  }

  if ((description?.length ?? 0) > maxDescriptionLength) {
    throw new UserError(
      `Keep the description under ${maxDescriptionLength} characters.`,
    );
  }
}

function requireCapacity(capacity?: number | null) {
  if (
    capacity !== undefined &&
    capacity !== null &&
    (!Number.isInteger(capacity) || capacity < 1)
  ) {
    throw new UserError('Capacity must be a whole number of at least 1.');
  }
}

// Reserve space for the generated ID, cancellation label and growing RSVP counts.
function requirePublishable(input: NewEvent, mention = false) {
  const view = eventView(
    {
      ...input,
      id: 2_147_483_647,
      messageId: null,
      discordEventId: null,
      status: 'cancelled',
      createdAt: new Date(),
    },
    { going: 2_147_483_647, maybe: 2_147_483_647, not_going: 0 },
  );
  const prefix =
    mention && input.mentionRoleId !== null
      ? `${roleMention(input.mentionRoleId)}\n`
      : '';

  if (prefix.length + (view.content?.length ?? 0) > maxContentLength) {
    throw new UserError(
      `Keep the complete event message under ${maxContentLength} characters. Shorten the title, description or location.`,
    );
  }
}

export const reminderChoices = [
  { label: '1 hour before', value: '60' },
  { label: '15 minutes before', value: '15' },
  { label: '1 day before', value: '1440' },
  { label: '1 day and 1 hour before', value: '1440,60' },
  { label: 'No reminders', value: 'none' },
] as const;

export function parseReminderMinutes(value: string | undefined): number[] {
  if (value === undefined) {
    return [60];
  }

  if (value.trim() === '' || value === 'none') {
    return [];
  }

  const minutes = value.split(',').map((part) => Number(part.trim()));

  if (
    minutes.length > maxReminders ||
    minutes.some((m) => !Number.isInteger(m) || m < 1 || m > 10_080)
  ) {
    throw new UserError(
      `Reminders are up to ${maxReminders} comma-separated minute values, e.g. "60,15".`,
    );
  }

  return [...new Set(minutes)];
}

interface Deps {
  events: EventRepository;
  scheduler: Scheduler;
  messenger: Messenger;
  calendar: Calendar;
  directory: Directory;
  authz: Authorizer;
  log: Logger;
  timezone: string;
}

export function createEventService(deps: Deps) {
  const { events, scheduler, messenger, calendar, directory, authz, log } =
    deps;

  const remindJob = defineJob({
    type: 'events.remind',
    payload: z.object({ eventId: z.number().int(), minutes: z.number().int() }),
    handle: async ({ eventId, minutes }) => {
      const event = await events.find(eventId);

      if (
        event?.status !== 'scheduled' ||
        event.startsAt.getTime() <= Date.now()
      ) {
        return;
      }

      const attendees = await events.attendees(eventId);
      const going = attendees
        .filter((a) => a.status === 'going')
        .map((a) => a.userId);
      const { content, pinged } = reminderText(event, minutes, going);

      await messenger.send(event.channelId, {
        content,
        mentions: { users: pinged },
      });
    },
  });

  const refresh = async (event: Event) => {
    if (event.messageId === null) {
      return;
    }

    const edited = await messenger.edit(
      event.channelId,
      event.messageId,
      eventView(event, await events.counts(event.id)),
    );

    if (!edited) {
      log.warn({ eventId: event.id }, 'Event message or channel was deleted');
    }
  };

  const scheduleReminders = async (
    event: Event,
    previous: readonly number[] = [],
  ) => {
    await Promise.all(
      previous.map((minutes) =>
        scheduler.cancel(remindJob, reminderKey(event.id, minutes)),
      ),
    );

    if (event.status !== 'scheduled') {
      return;
    }

    const upcoming = event.reminderMinutes
      .map((minutes) => ({
        minutes,
        runAt: new Date(event.startsAt.getTime() - minutes * 60_000),
      }))
      .filter(({ runAt }) => runAt.getTime() > Date.now());

    await Promise.all(
      upcoming.map(({ minutes, runAt }) =>
        scheduler.schedule(
          remindJob,
          { eventId: event.id, minutes },
          { runAt, key: reminderKey(event.id, minutes) },
        ),
      ),
    );
  };

  const syncNative = async (event: Event): Promise<string | null> => {
    try {
      if (event.status === 'cancelled') {
        if (event.discordEventId !== null) {
          await calendar.remove(event.guildId, event.discordEventId);
        }

        return null;
      }

      return await calendar.upsert(
        event.guildId,
        event.discordEventId,
        eventCalendarEntry(event),
      );
    } catch (error) {
      log.warn(
        { error, eventId: event.id },
        'Could not sync native Discord event',
      );

      return event.discordEventId;
    }
  };

  const publish = async (input: NewEvent, native = false) => {
    requirePublishable(input, true);

    let event = await events.insert(input);
    const view = eventView(event, { going: 0, maybe: 0, not_going: 0 });
    const sent = await messenger.send(
      event.channelId,
      event.mentionRoleId === null
        ? view
        : {
            ...view,
            content: `${roleMention(event.mentionRoleId)}\n${view.content ?? ''}`,
            mentions: { roles: [event.mentionRoleId] },
          },
    );

    event = await events.update(event.id, {
      messageId: sent.messageId,
      discordEventId: native ? await syncNative(event) : null,
    });
    await scheduleReminders(event);

    return event;
  };

  const requireEvent = async (actor: Actor, id: number) => {
    const event = await events.find(id);

    if (
      event?.guildId !== actor.guildId ||
      !(await directory.canView(actor, event.channelId))
    ) {
      throw new UserError(`Event #${id} does not exist.`);
    }

    return event;
  };

  const requireManageable = async (actor: Actor, id: number) => {
    const event = await requireEvent(actor, id);

    if (event.organizerId !== actor.userId) {
      await authz.require(actor, 'event:manage');
    }

    return event;
  };

  const requirePostable = async (actor: Actor, channelId: string) => {
    if (!(await directory.canPost(actor, channelId))) {
      throw new UserError(
        `You cannot post in ${channelMention(channelId)} yourself.`,
      );
    }
  };

  return {
    jobs: [remindJob],
    get: requireEvent,
    view: async (actor: Actor, id: number) => {
      const event = await requireEvent(actor, id);

      return eventView(event, await events.counts(event.id));
    },
    upcoming: (guildId: string) => events.upcoming(guildId),
    attendees: async (actor: Actor, id: number) => {
      const event = await requireEvent(actor, id);

      return { event, attendees: await events.attendees(event.id) };
    },
    publish: async (actor: Actor, input: NewEvent) => {
      await requirePostable(actor, input.channelId);

      return publish(input);
    },
    create: async (actor: Actor, request: EventRequest) => {
      await authz.require(actor, 'event:create');
      await requirePostable(actor, request.channelId);

      if (request.mentionRoleId !== undefined) {
        const role = await directory.role(actor.guildId, request.mentionRoleId);

        if (!role) {
          throw new UserError('That role no longer exists.');
        }

        requireMentionable(actor, role);
      }

      const { timezone } = deps;
      const startsAt = parseFutureWhen(request.start, timezone);
      const endsAt =
        request.end === undefined
          ? null
          : parseWhen(request.end, timezone, startsAt);

      if (endsAt && endsAt <= startsAt) {
        throw new UserError('The end must be after the start.');
      }

      requireText(request.title, request.description);
      requireCapacity(request.capacity);

      const event = await publish(
        {
          guildId: actor.guildId,
          title: request.title,
          description: request.description ?? null,
          startsAt,
          endsAt,
          timezone,
          location: request.location ?? null,
          organizerId: actor.userId,
          channelId: request.channelId,
          capacity: request.capacity ?? null,
          mentionRoleId: request.mentionRoleId ?? null,
          reminderMinutes: parseReminderMinutes(request.reminders),
          icons: request.icons ?? true,
        },
        request.native ?? false,
      );

      log.info({ eventId: event.id, actorId: actor.userId }, 'Event created');

      return event;
    },
    edit: async (actor: Actor, id: number, changes: EventChanges) => {
      const event = await requireManageable(actor, id);

      if (event.status !== 'scheduled') {
        throw new UserError('Cancelled events cannot be edited.');
      }

      const startsAt =
        changes.start === undefined
          ? event.startsAt
          : parseFutureWhen(changes.start, event.timezone);
      let endsAt = event.endsAt;

      if (changes.end !== undefined) {
        endsAt =
          changes.end === null
            ? null
            : parseWhen(changes.end, event.timezone, startsAt);
      }

      if (endsAt && endsAt <= startsAt) {
        throw new UserError('The end must be after the start.');
      }

      requireText(changes.title ?? event.title, changes.description);
      requireCapacity(changes.capacity);

      const updates = {
        title: changes.title ?? event.title,
        description:
          changes.description === undefined
            ? event.description
            : changes.description,
        location:
          changes.location === undefined ? event.location : changes.location,
        capacity:
          changes.capacity === undefined ? event.capacity : changes.capacity,
        icons: changes.icons ?? event.icons,
        startsAt,
        endsAt,
      };

      requirePublishable({ ...event, ...updates });

      let updated = await events.update(event.id, updates);

      if (updated.discordEventId !== null) {
        updated = await events.update(event.id, {
          discordEventId: await syncNative(updated),
        });
      }

      await refresh(updated);
      await scheduleReminders(updated, event.reminderMinutes);
      log.info({ eventId: event.id, actorId: actor.userId }, 'Event edited');

      return updated;
    },
    cancel: async (actor: Actor, id: number) => {
      const event = await requireManageable(actor, id);

      if (event.status === 'cancelled') {
        throw new UserError('That event is already cancelled.');
      }

      const cancelled = await events.update(event.id, { status: 'cancelled' });
      const [, , discordEventId] = await Promise.all([
        refresh(cancelled),
        scheduleReminders(cancelled, event.reminderMinutes),
        syncNative(cancelled),
      ]);

      log.info({ eventId: event.id, actorId: actor.userId }, 'Event cancelled');

      return discordEventId === cancelled.discordEventId
        ? cancelled
        : await events.update(event.id, { discordEventId });
    },
    rsvp: async (actor: Actor, id: number, status: RsvpStatus) => {
      const event = await requireEvent(actor, id);

      await events.setRsvp(event.id, actor.userId, status);

      return eventView(event, await events.counts(event.id));
    },
  };
}

export type EventService = ReturnType<typeof createEventService>;
