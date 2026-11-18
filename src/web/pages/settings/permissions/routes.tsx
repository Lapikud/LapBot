import { UserError } from '~/core/errors';
import { Hono } from 'hono';
import { back, field, flashOf, type Env, type WebDeps } from '~/web/context';
import { PermissionPage } from './index';

export function permissionRoutes({ services }: WebDeps) {
  return new Hono<Env>()
    .get('/', async (c) => {
      const { actor } = c.var;
      const grants = await services.permissions.list(actor);
      const server = await c.var.server();
      const roles = server.roles
        .filter((role) => !role.managed)
        .toSorted((a, b) => b.position - a.position);
      const selected = roles.find((role) => role.id === c.req.query('role'));
      const counts = new Map<string, number>();

      for (const grant of grants.filter((g) => g.subjectType !== 'user')) {
        counts.set(grant.roleId, (counts.get(grant.roleId) ?? 0) + 1);
      }

      return c.html(
        <PermissionPage
          roles={roles}
          selected={selected}
          counts={counts}
          grants={grants}
          catalogue={services.permissions.catalogue()}
          can={c.var.can}
          flash={flashOf(c)}
        />,
      );
    })
    .post('/member', async (c) => {
      const form = await c.req.formData();
      const action = form.get('action');
      const userId = field(form, 'userId') ?? '';

      if (
        (action !== 'grant' && action !== 'revoke') ||
        !/^\d{17,20}$/.test(userId)
      ) {
        throw new UserError('Choose a member and a valid action.');
      }

      const changed = await services.permissions[action](
        c.var.actor,
        userId,
        field(form, 'permission') ?? '',
        'user',
      );

      return back(c, '/settings/permissions', {
        notice: changed ? 'Member permission saved.' : 'Nothing changed.',
      });
    })
    .post('/:roleId{\\d+}', async (c) => {
      const roleId = c.req.param('roleId');
      const form = await c.req.formData();
      const { granted, revoked } = await services.permissions.setRole(
        c.var.actor,
        roleId,
        form.getAll('permission').map(String),
      );

      return back(c, `/settings/permissions?role=${roleId}`, {
        notice:
          granted + revoked === 0
            ? 'Nothing changed.'
            : `Saved: ${granted} added, ${revoked} removed.`,
      });
    });
}
