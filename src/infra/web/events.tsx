import { Hono } from 'hono';
import { reminderChoices } from '~/core/services';
import {
  back,
  checked,
  field,
  flashOf,
  formatter,
  type Env,
  type WebDeps,
} from './context';
import { ActionButton, ChannelSelect, Checkbox, Layout } from './layout';

const optional = ['end', 'description', 'location', 'reminders'] as const;

export function eventPages({ guildId, services, timezone }: WebDeps) {
  const date = formatter(timezone);

  return new Hono<Env>()
    .get('/', async (c) => {
      const upcoming = await services.events.upcoming(guildId);
      const { server } = c.var;

      return c.html(
        <Layout title="Events" path="/events" flash={flashOf(c)}>
          <form method="post" action="/events">
            <label>
              Title
              <input name="title" required maxlength={200} />
            </label>
            <div class="grid">
              <label>
                Start
                <input name="start" required placeholder="e.g. fri 18:00" />
              </label>
              <label>
                End
                <input name="end" placeholder="e.g. 21:00 or 3h" />
              </label>
            </div>
            <label>
              Description
              <textarea name="description" rows={3} maxlength={2000} />
            </label>
            <label>
              Location
              <input name="location" maxlength={200} />
            </label>
            <ChannelSelect server={server} />
            <div class="grid">
              <label>
                Capacity
                <input name="capacity" type="number" min={1} />
              </label>
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
                    <ActionButton
                      action={`/events/${e.id}/cancel`}
                      label="Cancel"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Layout>,
      );
    })
    .post('/', async (c) => {
      const form = await c.req.formData();
      const capacity = field(form, 'capacity');
      const event = await services.events.create(c.var.actor, {
        title: field(form, 'title') ?? '',
        start: field(form, 'start') ?? '',
        channelId: field(form, 'channelId') ?? '',
        native: checked(form, 'native'),
        icons: checked(form, 'icons'),
        ...(capacity !== undefined && { capacity: Number(capacity) }),
        ...Object.fromEntries(
          optional.flatMap((name) => {
            const value = field(form, name);

            return value === undefined ? [] : [[name, value]];
          }),
        ),
      });

      return back(c, '/events', { notice: `Event #${event.id} created.` });
    })
    .post('/:id{[0-9]+}/cancel', async (c) => {
      const id = Number(c.req.param('id'));

      await services.events.cancel(c.var.actor, id);

      return back(c, '/events', { notice: `Event #${id} cancelled.` });
    });
}
