import { Hono } from 'hono';
import { back, field, flashOf, type Env, type WebDeps } from '~/web/context';
import { BirthdayPage } from './index';

export function birthdayRoutes({ guildId, services, directory }: WebDeps) {
  return new Hono<Env>()
    .get('/', async (c) => {
      const [server, settings, upcoming] = await Promise.all([
        c.var.server(),
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
        <BirthdayPage
          settings={settings}
          upcoming={upcoming}
          names={names}
          roles={roles}
          server={server}
          can={c.var.can}
          flash={flashOf(c)}
        />,
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

      return back(c, '/forms/birthdays', { notice: message });
    })
    .post('/signup', async (c) => {
      const form = await c.req.formData();

      await services.birthdays.postSignup(
        c.var.actor,
        field(form, 'channelId') ?? '',
      );

      return back(c, '/forms/birthdays', { notice: 'Sign-up message posted.' });
    });
}
