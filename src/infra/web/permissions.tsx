import { Hono } from 'hono';
import type { PermissionDefinition, RoleInfo } from '~/domain';
import { back, flashOf, type Env, type WebDeps } from './context';
import { Layout } from './layout';

const title = (name: string) =>
  `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

function groupsOf(catalogue: readonly PermissionDefinition[]) {
  const groups = new Map<string, PermissionDefinition[]>();

  for (const permission of catalogue) {
    const group = title(permission.group ?? 'other');

    groups.set(group, [...(groups.get(group) ?? []), permission]);
  }

  return [...groups];
}

function RoleList({
  roles,
  selected,
  counts,
}: Readonly<{
  roles: RoleInfo[];
  selected: string | undefined;
  counts: ReadonlyMap<string, number>;
}>) {
  return (
    <ul class="role-list">
      {roles.map((role) => (
        <li key={role.id}>
          <a
            href={`/permissions?role=${role.id}`}
            aria-current={role.id === selected ? 'true' : undefined}
          >
            {role.everyone ? 'Everyone' : `@${role.name}`}
            <small>{counts.get(role.id) ?? 0}</small>
          </a>
        </li>
      ))}
    </ul>
  );
}

function RoleForm({
  role,
  granted,
  catalogue,
}: Readonly<{
  role: RoleInfo;
  granted: ReadonlySet<string>;
  catalogue: readonly PermissionDefinition[];
}>) {
  return (
    <form method="post" action={`/permissions/${role.id}`}>
      <h2>{role.everyone ? 'Everyone' : `@${role.name}`}</h2>
      {groupsOf(catalogue).map(([group, permissions]) => (
        <fieldset key={group}>
          <legend>{group}</legend>
          {permissions.map((permission) => (
            <label key={permission.id}>
              <input
                type="checkbox"
                name="permission"
                value={permission.id}
                checked={granted.has(permission.id)}
              />
              {permission.description} <small>{permission.id}</small>
            </label>
          ))}
        </fieldset>
      ))}
      <button type="submit">Save</button>
    </form>
  );
}

export function permissionPages({ services }: WebDeps) {
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
        <Layout title="Permissions" path="/permissions" flash={flashOf(c)}>
          <p>
            Server administrators can do everything, including opening this
            dashboard. Pick a role to choose what its members may do.
          </p>
          <div class="permissions">
            <RoleList roles={roles} selected={selected?.id} counts={counts} />
            {selected ? (
              <RoleForm
                role={selected}
                granted={
                  new Set(
                    grants
                      .filter((grant) => grant.roleId === selected.id)
                      .map((grant) => grant.permission),
                  )
                }
                catalogue={services.permissions.catalogue()}
              />
            ) : (
              <p>Pick a role on the left.</p>
            )}
          </div>
        </Layout>,
      );
    })
    .post('/:roleId{[0-9]+}', async (c) => {
      const roleId = c.req.param('roleId');
      const form = await c.req.formData();
      const { granted, revoked } = await services.permissions.setRole(
        c.var.actor,
        roleId,
        form.getAll('permission').map(String),
      );

      return back(c, `/permissions?role=${roleId}`, {
        notice:
          granted + revoked === 0
            ? 'Nothing changed.'
            : `Saved: ${granted} added, ${revoked} removed.`,
      });
    });
}
