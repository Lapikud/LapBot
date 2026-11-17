import type { Permission, PermissionDefinition } from '~/core/permission';
import type { RoleInfo } from '~/core/ports/directory';
import type { Grant } from '~/features/permissions/model';
import type { Flash } from '~/web/context';
import { Layout } from '~/web/layout';
import { RoleForm } from './form';
import { RolePicker } from './picker';

interface Props {
  roles: RoleInfo[];
  selected: RoleInfo | undefined;
  counts: ReadonlyMap<string, number>;
  grants: Grant[];
  catalogue: PermissionDefinition[];
  can: ReadonlySet<Permission>;
  flash: Flash;
}

export function PermissionPage({
  roles,
  selected,
  counts,
  grants,
  catalogue,
  can,
  flash,
}: Readonly<Props>) {
  return (
    <Layout
      can={can}
      title="Permissions"
      path="/settings/permissions"
      flash={flash}
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
          catalogue={catalogue}
        />
      ) : null}
    </Layout>
  );
}
