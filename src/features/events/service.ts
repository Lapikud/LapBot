import { eventCalendarEntry } from './calendar';
import { eventView, reminderText, type DayEntry } from './message';
import { z } from 'zod';
import {
  maxContentLength,
  mentionLine,
  withMentions,
  type Mentions,
} from '~/core/message';
import {
  addCalendarDays,
  calendarDay,
  parseFutureWhen,
  parseWhen,
  zonedTime,
} from '~/core/helpers/time';
import { visibleRecords } from '~/core/helpers/visibility';
import { UserError } from '~/core/errors';
import type { Actor } from '~/core/actor';
import { requirePostable } from '~/core/helpers/posting';
import type { Authorizer } from '~/core/ports/authorization';
import type { Calendar } from '~/core/ports/calendar';
import type { Directory } from '~/core/ports/directory';
import type { Logger } from '~/core/ports/logger';
import type { Messenger } from '~/core/ports/messenger';
import { type Scheduler } from '~/core/ports/scheduler';
import { defineJob } from '~/core/helpers/jobs';
import type { PollService } from '~/features/polls/service';
import { validatePollOptions } from '~/features/polls/rules';
import type {
  Event,
  NewEvent,
  RsvpCounts,
  RsvpStatus,
  EventRepository,
} from './model';

const maxReminders = 3;
const liveView = (event: Event, counts: RsvpCounts) =>
  withMentions(eventView(event, counts), event.mentions);
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
  mentions?: Mentions;
  reminders?: string;
  calendar?: boolean;
  icons?: boolean;
  vote?: { options: readonly string[]; closes?: string };
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

function voteDeadline(
  vote: EventRequest['vote'],
  startsAt: Date,
  timezone: string,
  available: boolean,
): Date {
  if (vote === undefined) {
    return startsAt;
  }

  if (!available) {
    throw new UserError('Votes are not available.');
  }

  validatePollOptions(vote.options);

  return vote.closes === undefined
    ? startsAt
    : parseFutureWhen(vote.closes, timezone);
}

function requirePublishable(input: NewEvent, mention = false) {
  const view = eventView(
    {
      ...input,
      id: 2_147_483_647,
      messageId: null,
      calendarEventId: null,
      pollId: null,
      status: 'cancelled',
      createdAt: new Date(),
    },
    { going: 2_147_483_647, maybe: 2_147_483_647, not_going: 0 },
  );
  const line = mention ? mentionLine(input.mentions) : '';
  const prefix = line === '' ? '' : `${line}\n`;

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
  calendar?: Calendar;
  directory: Directory;
  authz: Authorizer;
  log: Logger;
  timezone: string;
  polls?: Pick<PollService, 'publish' | 'onClosed'>;
}

export function createEventService(deps: Deps) {
  const {
    events,
    scheduler,
    messenger,
    calendar,
    directory,
    authz,
    log,
    polls,
  } = deps;

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
      liveView(event, await events.counts(event.id)),
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

  const syncCalendar = async (event: Event): Promise<string | null> => {
    if (calendar === undefined) {
      return event.calendarEventId;
    }

    try {
      if (event.status === 'cancelled') {
        if (event.calendarEventId !== null) {
          await calendar.remove(event.calendarEventId);
        }

        return null;
      }

      return await calendar.upsert(
        event.calendarEventId,
        eventCalendarEntry(event),
      );
    } catch (error) {
      log.warn({ error, eventId: event.id }, 'Could not sync Google Calendar');

      throw new UserError(
        event.status === 'cancelled'
          ? `Calendar removal failed. The Discord event is cancelled; retry /event cancel id:${event.id}.`
          : 'Calendar synchronization failed. The Discord event is saved; retry calendar posting.',
      );
    }
  };

  const attachPoll = (id: number, pollId: number) =>
    events.update(id, { pollId });

  const decide = async (
    id: number,
    changes: { title?: string; description?: string | null },
  ) => {
    let updated = await events.update(id, changes);

    await refresh(updated);

    if (updated.calendarEventId !== null) {
      updated = await events.update(id, {
        calendarEventId: await syncCalendar(updated),
      });
    }

    return updated;
  };

  polls?.onClosed(async (poll, results) => {
    const event = await events.byPoll(poll.id);
    const [winner] = results.winners;

    if (
      poll.source !== null ||
      event?.status !== 'scheduled' ||
      winner === undefined ||
      results.tie
    ) {
      return;
    }

    await decide(event.id, {
      description: [`**Chosen:** ${winner.label}`, event.description]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, maxDescriptionLength),
    });
  });

  const requireCalendarChannel = async (actor: Actor, channelId: string) => {
    if (calendar === undefined) {
      throw new UserError('The club Google Calendar is not set up.');
    }

    if (!(await directory.isPublic(actor.guildId, channelId))) {
      throw new UserError(
        'Only events in channels everyone can see can go to the club calendar.',
      );
    }
  };

  const publish = async (input: NewEvent, synced = false) => {
    requirePublishable(input, true);

    let event = await events.insert(input);
    const view = eventView(event, { going: 0, maybe: 0, not_going: 0 });
    const sent = await messenger.send(
      event.channelId,
      withMentions(view, event.mentions),
    );

    event = await events.update(event.id, { messageId: sent.messageId });
    await scheduleReminders(event);
    if (synced) {
      event = await events.update(event.id, {
        calendarEventId: await syncCalendar(event),
      });
    }

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

  return {
    jobs: [remindJob],
    calendarEnabled: calendar !== undefined,
    crosspost: async (actor: Actor, id: number) => {
      await authz.require(actor, 'event:calendar:publish');
      const event = await requireEvent(actor, id);

      if (event.status !== 'scheduled') {
        throw new UserError('Cancelled events cannot be crossposted.');
      }

      await requireCalendarChannel(actor, event.channelId);
      if (calendar === undefined) {
        throw new UserError('The club Google Calendar is not set up.');
      }

      const calendarEventId = await syncCalendar(event);

      return events.update(id, { calendarEventId });
    },
    get: requireEvent,
    byPoll: (pollId: number) => events.byPoll(pollId),
    attachPoll,
    decide,
    refresh: async (actor: Actor, id: number) =>
      refresh(await requireEvent(actor, id)),
    view: async (actor: Actor, id: number) => {
      const event = await requireEvent(actor, id);

      return liveView(event, await events.counts(event.id));
    },
    upcoming: (guildId: string) => events.upcoming(guildId),
    sameDay: async (actor: Actor, start: string) => {
      const { timezone } = deps;
      const startsAt = parseFutureWhen(start, timezone);
      const day = calendarDay(startsAt, timezone);
      const from = zonedTime(day, 0, timezone);
      const to = zonedTime(addCalendarDays(day, 1), 0, timezone);
      const local = await visibleRecords(
        directory,
        actor,
        await events.between(actor.guildId, from, to),
      );
      const linked = new Set(local.map((event) => event.calendarEventId));
      const external =
        calendar === undefined
          ? []
          : await calendar.between(from, to).catch((error: unknown) => {
              log.warn({ error }, 'Could not read Google Calendar');

              return [];
            });
      const entries: DayEntry[] = [
        ...local.map((event) => ({
          title: event.title,
          startsAt: event.startsAt,
          allDay: false,
        })),
        ...external.filter((entry) => !linked.has(entry.id)),
      ];

      return {
        startsAt,
        entries: entries.toSorted(
          (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
        ),
      };
    },
    attendees: async (actor: Actor, id: number) => {
      const event = await requireEvent(actor, id);

      return { event, attendees: await events.attendees(event.id) };
    },
    publish: async (actor: Actor, input: NewEvent) => {
      await requirePostable(directory, actor, input.channelId);

      return publish(input);
    },
    create: async (actor: Actor, request: EventRequest) => {
      await authz.require(actor, 'event:create');
      await requirePostable(
        directory,
        actor,
        request.channelId,
        request.mentions,
      );

      if (request.calendar === true) {
        await authz.require(actor, 'event:calendar:publish');
        await requireCalendarChannel(actor, request.channelId);
      }

      const { timezone } = deps;
      const startsAt = parseFutureWhen(request.start, timezone);

      const voteClosesAt = voteDeadline(
        request.vote,
        startsAt,
        timezone,
        polls !== undefined,
      );

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
          mentions: request.mentions ?? {},
          reminderMinutes: parseReminderMinutes(request.reminders),
          icons: request.icons ?? true,
        },
        request.calendar ?? false,
      );

      log.info({ eventId: event.id, actorId: actor.userId }, 'Event created');

      if (request.vote === undefined) {
        return event;
      }

      if (polls === undefined) {
        throw new UserError('Votes are not available.');
      }

      const poll = await polls.publish(actor, {
        guildId: actor.guildId,
        channelId: event.channelId,
        creatorId: actor.userId,
        question: `What should we do at ${event.title}?`.slice(0, 256),
        options: request.vote.options.map((label) => ({ label })),
        closesAt: voteClosesAt,
      });

      return attachPoll(event.id, poll.id);
    },
    edit: async (actor: Actor, id: number, changes: EventChanges) => {
      const event = await requireManageable(actor, id);

      if (event.status !== 'scheduled') {
        throw new UserError('Cancelled events cannot be edited.');
      }

      if (needsCalendarPermission(event, changes)) {
        await authz.require(actor, 'event:calendar:publish');
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

      await refresh(updated);
      await scheduleReminders(updated, event.reminderMinutes);

      if (updated.calendarEventId !== null) {
        updated = await events.update(event.id, {
          calendarEventId: await syncCalendar(updated),
        });
      }

      log.info({ eventId: event.id, actorId: actor.userId }, 'Event edited');

      return updated;
    },
    cancel: async (actor: Actor, id: number) => {
      const event = await requireManageable(actor, id);

      if (event.status === 'cancelled' && event.calendarEventId === null) {
        throw new UserError('That event is already cancelled.');
      }

      const cancelled = await events.update(event.id, { status: 'cancelled' });
      const [, , calendarEventId] = await Promise.all([
        refresh(cancelled),
        scheduleReminders(cancelled, event.reminderMinutes),
        syncCalendar(cancelled),
      ]);

      log.info({ eventId: event.id, actorId: actor.userId }, 'Event cancelled');

      return calendarEventId === cancelled.calendarEventId
        ? cancelled
        : await events.update(event.id, { calendarEventId });
    },
    rsvp: async (actor: Actor, id: number, status: RsvpStatus) => {
      const event = await requireEvent(actor, id);

      await events.setRsvp(event.id, actor.userId, status);

      return liveView(event, await events.counts(event.id));
    },
  };
}

export type EventService = ReturnType<typeof createEventService>;

function needsCalendarPermission(event: Event, changes: EventChanges): boolean {
  return (
    event.calendarEventId !== null &&
    ['title', 'description', 'start', 'end', 'location'].some(
      (key) => key in changes,
    )
  );
}
