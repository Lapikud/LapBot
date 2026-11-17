import { Hono } from 'hono';
import { back, flashOf, type Env, type WebDeps } from '~/web/context';
import { PermissionPage } from './index';

export function permissionRoutes({ services }: WebDeps) {
  return new Hono<Env>()
    .get('/', async (c) => {
      const { actor, server } = c.var;
      const grants = await services.permissions.list(actor);
      const roles = server.roles
        .filter((role) => !role.managed)
        .toSorted((a, b) => b.position - a.position);
      const selected = roles.find((role) => role.id === c.req.query('role'));
      const counts = new Map<string, number>();

      for (const grant of grants) {
        counts.set(grant.roleId, (counts.get(grant.roleId) ?? 0) + 1);
      }

      return c.html(
        <PermissionPage
          roles={roles}
          selected={selected}
          counts={counts}
          grants={grants}
          catalogue={selected ? services.permissions.catalogue() : []}
          can={c.var.can}
          flash={flashOf(c)}
        />,
      );
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
