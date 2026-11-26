import { Hono } from 'hono';
import { applicationAdmin } from '~/core/permission';
import { UserError } from '~/core/errors';
import { back, flashOf, type Env, type WebDeps } from '~/web/context';
import { roleName } from './groups';
import { PermissionPage } from './index';

const snowflake = /^\d{17,20}$/;

export function permissionRoutes({ services, directory, guildId }: WebDeps) {
  return new Hono<Env>()
    .get('/', async (c) => {
      const { actor } = c.var;
      const advanced = c.req.query('advanced') === '1';
      const member = c.req.query('member');
      const checked = c.req.query('check');
      const [grants, server] = await Promise.all([
        services.permissions.list(actor),
        c.var.server(),
      ]);
      const roles = server.roles
        .filter((role) => !role.managed)
        .toSorted(
          (a, b) =>
            Number(b.everyone) - Number(a.everyone) || b.position - a.position,
        );
      const counts = new Map<string, number>();

      for (const grant of grants.filter((g) => g.subjectType !== 'user')) {
        counts.set(grant.roleId, (counts.get(grant.roleId) ?? 0) + 1);
      }

      const wanted = c.req.query('role');
      const role = roles.find((r) =>
        wanted === undefined ? r.everyone : r.id === wanted,
      );
      const memberName =
        advanced && member !== undefined && snowflake.test(member)
          ? ((await directory.displayName(guildId, member)) ?? member)
          : undefined;
      const subject =
        memberName !== undefined && member !== undefined
          ? { type: 'user' as const, id: member, name: memberName }
          : role && {
              type: 'role' as const,
              id: role.id,
              name: roleName(role),
            };
      const granted = new Set(
        grants
          .filter(
            (grant) =>
              grant.roleId === subject?.id &&
              (grant.subjectType ?? 'role') === subject.type,
          )
          .map((grant) => grant.permission),
      );
      const access =
        advanced && checked !== undefined && snowflake.test(checked)
          ? await services.permissions.explain(actor, checked)
          : undefined;

      return c.html(
        <PermissionPage
          roles={roles}
          members={server.members}
          counts={counts}
          subject={subject}
          granted={granted}
          access={access}
          checked={checked}
          catalogue={services.permissions.catalogue()}
          advanced={advanced}
          delegation={advanced && c.var.can.has(applicationAdmin)}
          can={c.var.can}
          flash={flashOf(c)}
        />,
      );
    })
    .post(String.raw`/:type{role|user}/:id{\d+}`, async (c) => {
      const type = c.req.param('type') === 'user' ? 'user' : 'role';
      const id = c.req.param('id') ?? '';
      const form = await c.req.formData();
      const shown = form.getAll('shown').map(String);

      if (shown.length === 0) {
        throw new UserError('Nothing to save.');
      }

      const { granted, revoked } = await services.permissions.setGrants(
        c.var.actor,
        { type, id },
        form.getAll('permission').map(String),
        shown,
      );
      const advanced = c.req.query('advanced') === '1' ? '&advanced=1' : '';
      const target = type === 'user' ? `member=${id}` : `role=${id}`;

      return back(c, `/settings/permissions?${target}${advanced}`, {
        notice:
          granted + revoked === 0
            ? 'Nothing changed.'
            : `Saved: ${granted} added, ${revoked} removed.`,
      });
    });
}
