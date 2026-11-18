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
  owns,
  type Env,
  type WebDeps,
} from '~/web/context';
import { NewEventPage } from './create';
import { EditEventPage } from './edit';
import { EventPage } from './index';
import { changesOf, fieldsOf } from './submission';
import { entryLabel } from '~/features/events/message';

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
        ...(reminders !== undefined && { reminders }),
      });

      return back(c, '/post/events', { notice: `Event #${event.id} created.` });
    })
    .get(String.raw`/:id{\d+}`, async (c) => {
      const event = await services.events.get(
        c.var.actor,
        Number(c.req.param('id')),
      );

      if (!owns(c, event.organizerId, 'event:manage')) {
        throw new UserError('Only the organizer can edit this event.');
      }

      return c.html(
        <EditEventPage
          event={event}
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

      return back(c, '/post/events', { notice: `Event #${id} updated.` });
    })
    .post(String.raw`/:id{\d+}/calendar`, async (c) => {
      const id = Number(c.req.param('id'));

      await services.events.crosspost(c.var.actor, id);

      return back(c, '/post/events', {
        notice: `Event #${id} posted to the calendar.`,
      });
    })
    .post(String.raw`/:id{\d+}/cancel`, async (c) => {
      const id = Number(c.req.param('id'));

      await services.events.cancel(c.var.actor, id);

      return back(c, '/post/events', { notice: `Event #${id} cancelled.` });
    });
}
