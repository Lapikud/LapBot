import { Hono } from 'hono';
import { back, field, flashOf, type Env, type WebDeps } from './context';
import { ChannelSelect, Layout } from './layout';

const dayMonth = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

export function birthdayPages({ guildId, services, directory }: WebDeps) {
  return new Hono<Env>()
    .get('/', async (c) => {
      const { server } = c.var;
      const [settings, upcoming] = await Promise.all([
        services.birthdays.settings(guildId),
        services.birthdays.upcoming(guildId),
      ]);
      const names = await Promise.all(
        upcoming.map(
          async ({ userId }) =>
            (await directory.displayName(guildId, userId)) ?? 'Former member',
        ),
      );
      const roles = server.roles.filter(
        (role) => !role.everyone && !role.managed && role.botCanAssign,
      );

      return c.html(
        <Layout title="Birthdays" path="/birthdays" flash={flashOf(c)}>
          <p>
            {settings === undefined
              ? 'Birthday announcements are off.'
              : `Announced in ${server.channelName(settings.channelId)} at ${settings.hour}:00.`}{' '}
            Members add their own birthday with /birthday set.
          </p>
          <form method="post" action="/birthdays">
            <ChannelSelect server={server} />
            <div class="grid">
              <label>
                Role for the day
                <select name="roleId">
                  <option value="">None</option>
                  {roles.map(({ id, name }) => (
                    <option
                      key={id}
                      value={id}
                      selected={settings?.roleId === id}
                    >
                      @{name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Hour
                <input
                  name="hour"
                  type="number"
                  min={0}
                  max={23}
                  value={String(settings?.hour ?? 9)}
                />
              </label>
            </div>
            <div role="group">
              <button type="submit" name="action" value="save">
                Save
              </button>
              {settings === undefined ? null : (
                <button
                  type="submit"
                  name="action"
                  value="disable"
                  class="secondary outline"
                >
                  Turn off
                </button>
              )}
            </div>
          </form>
          <h2>Sign-up message</h2>
          <p>
            Post a message with an <q>Add my birthday</q> button. It keeps
            working after restarts, so one post is enough.
          </p>
          <form method="post" action="/birthdays/signup">
            <div role="group">
              <ChannelSelect server={server} />
              <button type="submit" class="secondary">
                Post
              </button>
            </div>
          </form>
          <h2>Coming up</h2>
          {upcoming.length === 0 ? (
            <p>No public birthdays saved yet.</p>
          ) : (
            <table>
              <tbody>
                {upcoming.map((birthday, index) => (
                  <tr key={birthday.userId}>
                    <td>{names[index]}</td>
                    <td>
                      {dayMonth.format(
                        new Date(
                          Date.UTC(2024, birthday.month - 1, birthday.day),
                        ),
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Layout>,
      );
    })
    .post('/', async (c) => {
      const form = await c.req.formData();
      const hour = field(form, 'hour');
      const channelId = field(form, 'channelId');
      const message = await services.birthdays.configure(
        c.var.actor,
        form.get('action') === 'disable'
          ? { disable: true }
          : {
              roleId: field(form, 'roleId') ?? null,
              ...(channelId !== undefined && { channelId }),
              ...(hour !== undefined && { hour: Number(hour) }),
            },
      );

      return back(c, '/birthdays', { notice: message });
    })
    .post('/signup', async (c) => {
      const form = await c.req.formData();

      await services.birthdays.postSignup(
        c.var.actor,
        field(form, 'channelId') ?? '',
      );

      return back(c, '/birthdays', { notice: 'Sign-up message posted.' });
    });
}
