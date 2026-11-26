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
        Discord administrators and Juhatus can do everything. Everyone sets what
        every member may do by default. Pick a role to add more, or manage a
        member grant below.
      </p>
      <details>
        <summary>Individual member permissions</summary>
        <form method="post" action="/settings/permissions/member">
          <label>
            Discord member ID
            <input name="userId" required pattern="[0-9]{17,20}" />
          </label>
          <label>
            Permission
            <select name="permission" required>
              {catalogue.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} — {p.description}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" name="action" value="grant">
            Grant
          </button>
          <button type="submit" name="action" value="revoke">
            Revoke
          </button>
        </form>
        <ul>
          {grants
            .filter((g) => g.subjectType === 'user')
            .map((g) => (
              <li key={`${g.roleId}:${g.permission}`}>
                {g.roleId}: {g.permission}
              </li>
            ))}
        </ul>
      </details>
      <RolePicker roles={roles} selected={selected?.id} counts={counts} />
      {selected ? (
        <RoleForm
          role={selected}
          granted={
            new Set(
              grants
                .filter(
                  (grant) =>
                    grant.subjectType !== 'user' &&
                    grant.roleId === selected.id,
                )
                .map((grant) => grant.permission),
            )
          }
          catalogue={catalogue}
        />
      ) : null}
    </Layout>
  );
}
