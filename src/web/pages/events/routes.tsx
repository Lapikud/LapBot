import { Hono } from 'hono';
import { UserError } from '~/core/errors';
import { visibleRecords } from '~/core/helpers/visibility';
import {
  allows,
  back,
  checked,
  field,
  flashOf,
  formatter,
  inputTime,
  mentionsFrom,
  owns,
  type Env,
  type WebDeps,
} from '~/web/context';
import { NewEventPage } from './create';
import { EventDetailPage } from './edit';
import { EventPage } from './index';
import { changesOf, fieldsOf } from './submission';
import { entryLabel, rsvpLabels } from '~/features/events/message';
import { rsvpStatuses } from '~/features/events/model';

export function eventRoutes({
  guildId,
  services,
  timezone,
  directory,
}: WebDeps) {
  const date = formatter(timezone);
  const time = inputTime(timezone);

  return new Hono<Env>()
    .get('/', async (c) => {
      const upcoming = await visibleRecords(
        directory,
        c.var.actor,
        await services.events.upcoming(guildId),
      );

      return c.html(
        <EventPage
          upcoming={upcoming}
          date={date}
          server={await c.var.server()}
          can={c.var.can}
          flash={flashOf(c)}
          canManage={(ownerId) => owns(c, ownerId, 'event:manage')}
        />,
      );
    })
    .get('/new', async (c) => {
      if (!allows(c, 'event:create')) {
        throw new UserError('You need the "event:create" permission.');
      }

      const start = c.req.query('day')?.trim() ?? '';
      const day =
        start === ''
          ? undefined
          : await services.events.sameDay(c.var.actor, start).then(
              ({ startsAt, entries }) => ({
                start,
                heading: date(startsAt),
                entries: entries.map((entry) => entryLabel(entry, timezone)),
              }),
              (error: unknown) => {
                if (error instanceof UserError) {
                  return { start, error: error.message };
                }

                throw error;
              },
            );

      return c.html(
        <NewEventPage
          time={time}
          server={await c.var.server()}
          can={c.var.can}
          flash={flashOf(c)}
          calendar={
            services.events.calendarEnabled &&
            allows(c, 'event:calendar:publish')
          }
          {...(day && { day })}
        />,
      );
    })
    .post('/', async (c) => {
      const form = await c.req.formData();
      const reminders = field(form, 'reminders');
      const event = await services.events.create(c.var.actor, {
        title: '',
        start: '',
        ...fieldsOf(form),
        channelId: field(form, 'channelId') ?? '',
        calendar: checked(form, 'calendar'),
        mentions: mentionsFrom(form),
        ...(reminders !== undefined && { reminders }),
      });

      return back(c, '/events', { notice: `Event #${event.id} created.` });
    })
    .get(String.raw`/:id{\d+}`, async (c) => {
      const { event, attendees } = await services.events.attendees(
        c.var.actor,
        Number(c.req.param('id')),
      );
      const named = await Promise.all(
        attendees.map(async ({ userId, status }) => ({
          status,
          name:
            (await directory.displayName(guildId, userId)) ?? 'a former member',
        })),
      );

      return c.html(
        <EventDetailPage
          event={event}
          attendees={named}
          manageable={owns(c, event.organizerId, 'event:manage')}
          server={await c.var.server()}
          date={date}
          time={time}
          can={c.var.can}
          flash={flashOf(c)}
        />,
      );
    })
    .post(String.raw`/:id{\d+}`, async (c) => {
      const id = Number(c.req.param('id'));

      await services.events.edit(
        c.var.actor,
        id,
        changesOf(await c.req.formData()),
      );

      return back(c, '/events', { notice: `Event #${id} updated.` });
    })
    .post('/suggest', async (c) => {
      const form = await c.req.formData();
      const { posted } = await services.eventSuggestions.suggest(
        c.var.actor,
        field(form, 'channelId') ?? '',
        field(form, 'text') ?? '',
      );

      return back(c, '/events', {
        notice: posted
          ? 'Idea suggested.'
          : 'Idea saved, but it could not be posted in that channel.',
      });
    })
    .post(String.raw`/:id{\d+}/rsvp`, async (c) => {
      const id = Number(c.req.param('id'));
      const answer = field(await c.req.formData(), 'status');
      const status = rsvpStatuses.find((value) => value === answer);

      if (status === undefined) {
        throw new UserError('Choose going, maybe or not going.');
      }

      await services.events.rsvp(c.var.actor, id, status);
      await services.events.refresh(c.var.actor, id);

      return back(c, `/events/${id}`, {
        notice: `RSVP saved: ${rsvpLabels[status]}.`,
      });
    })
    .post(String.raw`/:id{\d+}/calendar`, async (c) => {
      const id = Number(c.req.param('id'));

      await services.events.crosspost(c.var.actor, id);

      return back(c, '/events', {
        notice: `Event #${id} posted to the calendar.`,
      });
    })
    .post(String.raw`/:id{\d+}/cancel`, async (c) => {
      const id = Number(c.req.param('id'));

      await services.events.cancel(c.var.actor, id);

      return back(c, '/events', { notice: `Event #${id} cancelled.` });
    });
}
