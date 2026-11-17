import type { Permission, PermissionDefinition } from '~/core/permission';
import type { RoleInfo } from '~/core/ports/directory';
import type { Grant } from '~/features/permissions/model';
import type { Flash } from '~/web/context';
import { Layout } from '~/web/layout';
import { RoleForm } from './form';
import { RolePicker } from './picker';

interface Props {
  readonly roles: RoleInfo[];
  readonly selected: RoleInfo | undefined;
  readonly counts: ReadonlyMap<string, number>;
  readonly grants: Grant[];
  readonly catalogue: PermissionDefinition[];
  readonly can: ReadonlySet<Permission>;
  readonly flash: Flash;
}

export function PermissionPage({
  roles,
  selected,
  counts,
  grants,
  catalogue,
  can,
  flash,
}: Props) {
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
