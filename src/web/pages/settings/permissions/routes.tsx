import { Hono } from 'hono';
import { applicationAdmin, managePermissions } from '~/core/permission';
import { UserError } from '~/core/errors';
import type { MemberInfo } from '~/core/ports/directory';
import { back, flashOf, type Env, type WebDeps } from '~/web/context';
import { roleName } from './groups';
import { PermissionPage } from './index';
import { findMembers } from './picker';

const snowflake = /^\d{17,20}$/;

const search = (members: MemberInfo[], query: string | undefined) =>
  snowflake.test(query ?? '') ? undefined : findMembers(members, query);

export function permissionRoutes({ services, directory, guildId }: WebDeps) {
  const nameOf = async (query: string | undefined) =>
    query !== undefined && snowflake.test(query)
      ? ((await directory.displayName(guildId, query)) ?? query)
      : query;

  return new Hono<Env>()
    .get('/members', async (c) => {
      if (!c.var.can.has(managePermissions)) {
        return c.json([], 403);
      }

      const server = await c.var.server();

      return c.json(
        (findMembers(server.members, c.req.query('q')) ?? []).slice(0, 10),
      );
    })
    .get('/', async (c, next) => {
      const { members } = await c.var.server();
      const url = new URL(c.req.url);

      for (const name of ['member', 'check']) {
        const matches = search(members, c.req.query(name));

        if (matches?.length === 1) {
          url.searchParams.set(name, matches[0]?.id ?? '');

          return c.redirect(`${url.pathname}${url.search}`, 303);
        }
      }

      return next();
    })
    .get('/', async (c) => {
      const { actor } = c.var;
      const advanced = c.req.query('advanced') === '1';
      const member = c.req.query('member');
      const checked = c.req.query('check');
      const toggle = new URL(c.req.url).searchParams;

      if (advanced) {
        toggle.delete('advanced');
      } else {
        toggle.set('advanced', '1');
      }

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
          ? await nameOf(member)
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
          member={memberName ?? member}
          memberMatches={search(server.members, member)}
          checkMatches={search(server.members, checked)}
          counts={counts}
          subject={subject}
          granted={granted}
          access={access}
          checked={await nameOf(checked)}
          catalogue={services.permissions.catalogue()}
          advanced={advanced}
          toggle={`/settings/permissions?${toggle.toString()}`}
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
