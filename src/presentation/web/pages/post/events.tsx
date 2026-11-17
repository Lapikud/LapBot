import {
  Input,
  Select,
  Textarea,
} from '~/presentation/web/components/controls';
import { ActionButton } from '~/presentation/web/components/actions';
import { Checkbox } from '~/presentation/web/components/choices';
import { visibleRecords } from '~/core/helpers/visibility';
import { Hono } from 'hono';
import type { Event } from '~/features/events/model';
import { reminderChoices } from '~/features/events/service';
import { UserError } from '~/core/errors';
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
  type Form,
  type WebDeps,
} from '~/presentation/web/context';
import { Layout } from '~/presentation/web/layout';
import { ChannelSelect } from '~/presentation/web/components/selectors';

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
      <Input
        label="Title"
        name="title"
        required
        maxlength={200}
        value={event?.title}
      />
      <div class="grid">
        <Input
          label="Start"
          name="start"
          required
          placeholder="e.g. fri 18:00"
          value={time(event?.startsAt ?? null)}
        />
        <Input
          label="End"
          name="end"
          placeholder="e.g. 21:00 or 3h"
          value={time(event?.endsAt ?? null)}
        />
      </div>
      <Textarea
        label="Description"
        name="description"
        rows={3}
        maxlength={1500}
      >
        {event?.description}
      </Textarea>
      <div class="grid">
        <Input
          label="Location"
          name="location"
          maxlength={200}
          value={event?.location ?? ''}
        />
        <Input
          label="Capacity"
          name="capacity"
          type="number"
          min={1}
          value={event?.capacity === null ? '' : event?.capacity}
        />
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

function changesOf(form: Form) {
  const capacity = field(form, 'capacity');

  return {
    ...fieldsOf(form),
    ...(form.has('description') && {
      description: field(form, 'description') ?? null,
    }),
    ...(form.has('location') && { location: field(form, 'location') ?? null }),
    ...(form.has('end') && { end: field(form, 'end') ?? null }),
    ...(form.has('capacity') && {
      capacity: capacity === undefined ? null : Number(capacity),
    }),
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
          path="/post/events"
          flash={flashOf(c)}
          actions={
            allows(c, 'event:create') ? (
              <a href="/post/events/new">New event</a>
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
                          href={`/post/events/${e.id}`}
                          class="secondary outline"
                        >
                          Edit
                        </a>{' '}
                        <ActionButton
                          action={`/post/events/${e.id}/cancel`}
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
          path="/post/events"
          flash={flashOf(c)}
        >
          <form method="post" action="/post/events">
            <EventFields time={time} />
            <div class="grid">
              <ChannelSelect server={server} />
              <Select label="Reminders" name="reminders">
                {reminderChoices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </Select>
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

      return back(c, '/post/events', { notice: `Event #${event.id} created.` });
    })
    .get('/:id{\\d+}', async (c) => {
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
          path="/post/events"
          flash={flashOf(c)}
        >
          <form method="post" action={`/post/events/${event.id}`}>
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
    .post('/:id{\\d+}', async (c) => {
      const id = Number(c.req.param('id'));

      await services.events.edit(
        c.var.actor,
        id,
        changesOf(await c.req.formData()),
      );

      return back(c, '/post/events', { notice: `Event #${id} updated.` });
    })
    .post('/:id{\\d+}/cancel', async (c) => {
      const id = Number(c.req.param('id'));

      await services.events.cancel(c.var.actor, id);

      return back(c, '/post/events', { notice: `Event #${id} cancelled.` });
    });
}
