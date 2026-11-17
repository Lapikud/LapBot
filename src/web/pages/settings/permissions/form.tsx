import type { PermissionDefinition } from '~/core/permission';
import type { RoleInfo } from '~/core/ports/directory';
import { Checkbox } from '~/web/components/choices';
import { groupsOf, roleName } from './groups';

export function RoleForm({
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
