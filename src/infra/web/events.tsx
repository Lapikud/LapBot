import { Hono } from 'hono';
import type { Event } from '~/core/ports';
import { reminderChoices } from '~/core/services';
import { UserError } from '~/domain';
import {
  allows,
  back,
  checked,
  field,
  flashOf,
  formatter,
  inputTime,
  owns,
  visibleRecords,
  type Env,
  type Form,
  type WebDeps,
} from './context';
import { ActionButton, ChannelSelect, Checkbox, Layout } from './layout';

const textFields = [
  'title',
  'start',
  'end',
  'description',
  'location',
] as const;

function EventFields({
  event,
  time,
}: Readonly<{ event?: Event; time: (date: Date | null) => string }>) {
  return (
    <>
      <label>
        Title
        <input name="title" required maxlength={200} value={event?.title} />
      </label>
      <div class="grid">
        <label>
          Start
          <input
            name="start"
            required
            placeholder="e.g. fri 18:00"
            value={time(event?.startsAt ?? null)}
          />
        </label>
        <label>
          End
          <input
            name="end"
            placeholder="e.g. 21:00 or 3h"
            value={time(event?.endsAt ?? null)}
          />
        </label>
      </div>
      <label>
        Description
        <textarea name="description" rows={3} maxlength={1500}>
          {event?.description}
        </textarea>
      </label>
      <div class="grid">
        <label>
          Location
          <input
            name="location"
            maxlength={200}
            value={event?.location ?? ''}
          />
        </label>
        <label>
          Capacity
          <input
            name="capacity"
            type="number"
            min={1}
            value={event?.capacity === null ? '' : event?.capacity}
          />
        </label>
      </div>
    </>
  );
}

function fieldsOf(form: Form) {
  const capacity = field(form, 'capacity');

  return {
    ...Object.fromEntries(
      textFields.flatMap((name) => {
        const value = field(form, name);

        return value === undefined ? [] : [[name, value]];
      }),
    ),
    icons: checked(form, 'icons'),
    ...(capacity !== undefined && { capacity: Number(capacity) }),
  };
}

export function eventPages({
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
      const { server } = c.var;

      return c.html(
        <Layout
          can={c.var.can}
          title="Events"
          path="/events"
          flash={flashOf(c)}
          actions={
            allows(c, 'event:create') ? (
              <a href="/events/new" role="button">
                New event
              </a>
            ) : null
          }
        >
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Starts</th>
                <th>Channel</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {upcoming.map((e) => (
                <tr key={e.id}>
                  <td>{e.id}</td>
                  <td>{e.title}</td>
                  <td>{date(e.startsAt)}</td>
                  <td>{server.channelName(e.channelId)}</td>
                  <td>
                    {owns(c, e.organizerId, 'event:manage') ? (
                      <>
                        <a
                          href={`/events/${e.id}`}
                          role="button"
                          class="secondary outline"
                        >
                          Edit
                        </a>{' '}
                        <ActionButton
                          action={`/events/${e.id}/cancel`}
                          label="Cancel"
                        />
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Layout>,
      );
    })
    .get('/new', (c) => {
      if (!allows(c, 'event:create')) {
        throw new UserError('You need the "event:create" permission.');
      }

      const { server } = c.var;

      return c.html(
        <Layout
          can={c.var.can}
          title="New event"
          path="/events"
          flash={flashOf(c)}
        >
          <form method="post" action="/events">
            <EventFields time={time} />
            <div class="grid">
              <ChannelSelect server={server} />
              <label>
                Reminders
                <select name="reminders">
                  {reminderChoices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset>
              <Checkbox name="native" label="Also create a Discord event" />
              <Checkbox name="icons" label="Show 🗓️ 🕐 📍 icons" checked />
            </fieldset>
            <button type="submit">Create event</button>
          </form>
        </Layout>,
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
        native: checked(form, 'native'),
        ...(reminders !== undefined && { reminders }),
      });

      return back(c, '/events', { notice: `Event #${event.id} created.` });
    })
    .get('/:id{[0-9]+}', async (c) => {
      const event = await services.events.get(
        c.var.actor,
        Number(c.req.param('id')),
      );

      if (!owns(c, event.organizerId, 'event:manage')) {
        throw new UserError('Only the organizer can edit this event.');
      }

      return c.html(
        <Layout
          can={c.var.can}
          title={`Edit event #${event.id}`}
          path="/events"
          flash={flashOf(c)}
        >
          <form method="post" action={`/events/${event.id}`}>
            <EventFields event={event} time={time} />
            <fieldset>
              <Checkbox
                name="icons"
                label="Show 🗓️ 🕐 📍 icons"
                checked={event.icons}
              />
            </fieldset>
            <button type="submit">Save changes</button>
          </form>
        </Layout>,
      );
    })
    .post('/:id{[0-9]+}', async (c) => {
      const id = Number(c.req.param('id'));

      await services.events.edit(
        c.var.actor,
        id,
        fieldsOf(await c.req.formData()),
      );

      return back(c, '/events', { notice: `Event #${id} updated.` });
    })
    .post('/:id{[0-9]+}/cancel', async (c) => {
      const id = Number(c.req.param('id'));

      await services.events.cancel(c.var.actor, id);

      return back(c, '/events', { notice: `Event #${id} cancelled.` });
    });
}
