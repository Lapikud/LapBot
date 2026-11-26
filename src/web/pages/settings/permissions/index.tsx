import type { Permission, PermissionDefinition } from '~/core/permission';
import type { MemberInfo, RoleInfo } from '~/core/ports/directory';
import type { GrantSubject } from '~/features/permissions/model';
import type { Flash } from '~/web/context';
import { Layout } from '~/web/layout';
import { GrantForm } from './form';
import { MemberPicker, RolePicker } from './picker';

interface Props {
  roles: RoleInfo[];
  members: MemberInfo[];
  counts: ReadonlyMap<string, number>;
  subject: { type: GrantSubject; id: string; name: string } | undefined;
  granted: ReadonlySet<string>;
  access:
    | ReadonlyArray<{ permission: PermissionDefinition; sources: string[] }>
    | undefined;
  checked: string | undefined;
  catalogue: PermissionDefinition[];
  advanced: boolean;
  delegation: boolean;
  can: ReadonlySet<Permission>;
  flash: Flash;
}

export function PermissionPage({
  roles,
  members,
  counts,
  subject,
  granted,
  access,
  checked,
  catalogue,
  advanced,
  delegation,
  can,
  flash,
}: Readonly<Props>) {
  return (
    <Layout
      can={can}
      title="Permissions"
      path="/settings/permissions"
      flash={flash}
      actions={
        <a href={advanced ? '/settings/permissions' : '?advanced=1'}>
          {advanced ? 'Hide advanced' : 'Show advanced'}
        </a>
      }
    >
      <p>
        Discord administrators and Juhatus can do everything. Everyone sets what
        every member may do; roles and members add to it.
      </p>
      <RolePicker
        roles={roles}
        selected={subject?.type === 'role' ? subject.id : undefined}
        counts={counts}
        advanced={advanced}
      />
      {advanced ? (
        <>
          <datalist id="permission-members">
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name} ({member.username})
              </option>
            ))}
          </datalist>
          <MemberPicker
            name="member"
            label="Member grants"
            selected={subject?.type === 'user' ? subject.id : undefined}
          />
        </>
      ) : null}
      {subject ? (
        <GrantForm
          subject={subject}
          granted={granted}
          catalogue={catalogue}
          advanced={advanced}
          delegation={delegation}
        />
      ) : null}
      {advanced ? (
        <>
          <h2>Effective access</h2>
          <p class="hint">
            Everything a member can do, and where each permission comes from.
          </p>
          <MemberPicker name="check" label="Member" selected={checked} />
          {access ? (
            <table>
              <thead>
                <tr>
                  <th>Permission</th>
                  <th>From</th>
                </tr>
              </thead>
              <tbody>
                {access.map(({ permission, sources }) => (
                  <tr key={permission.id}>
                    <td>
                      {permission.description} <small>{permission.id}</small>
                    </td>
                    <td>{sources.length === 0 ? '—' : sources.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : null}
    </Layout>
  );
}
