import { Hono } from 'hono';
import type { PermissionDefinition } from '~/core/permission';
import type { RoleInfo } from '~/core/ports/directory';
import {
  back,
  flashOf,
  type Env,
  type WebDeps,
} from '~/presentation/web/context';
import { Layout } from '~/presentation/web/layout';
import { Checkbox } from '~/presentation/web/components/choices';
import { FormActions } from '~/presentation/web/components/actions';

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

const roleName = (role: RoleInfo) =>
  role.everyone ? 'Everyone' : `@${role.name}`;

function RolePicker({
  roles,
  selected,
  counts,
}: Readonly<{
  roles: RoleInfo[];
  selected: string | undefined;
  counts: ReadonlyMap<string, number>;
}>) {
  return (
    <form method="get" action="/settings/permissions">
      <FormActions>
        <select name="role" aria-label="Role" required>
          <option value="" disabled selected={selected === undefined}>
            Pick a role
          </option>
          {roles.map((role) => (
            <option
              key={role.id}
              value={role.id}
              selected={role.id === selected}
            >
              {roleName(role)} ({counts.get(role.id) ?? 0})
            </option>
          ))}
        </select>
        <button type="submit" class="secondary">
          Open
        </button>
      </FormActions>
    </form>
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
    <form method="post" action={`/settings/permissions/${role.id}`}>
      <h2>{roleName(role)}</h2>
      {groupsOf(catalogue).map(([group, permissions]) => (
        <fieldset key={group}>
          <legend>{group}</legend>
          {permissions.map((permission) => (
            <Checkbox
              key={permission.id}
              name="permission"
              value={permission.id}
              checked={granted.has(permission.id)}
              label={
                <>
                  {permission.description} <small>{permission.id}</small>
                </>
              }
            />
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
        <Layout
          can={c.var.can}
          title="Permissions"
          path="/settings/permissions"
          flash={flashOf(c)}
        >
          <p>
            Server administrators can do everything, including opening this
            dashboard. Pick a role to choose what its members may do.
          </p>
          <RolePicker roles={roles} selected={selected?.id} counts={counts} />
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
          ) : null}
        </Layout>,
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
