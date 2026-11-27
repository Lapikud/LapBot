import type { Permission, PermissionDefinition } from '~/core/permission';
import type { MemberInfo, RoleInfo } from '~/core/ports/directory';
import type { GrantSubject } from '~/features/permissions/model';
import type { Flash } from '~/web/context';
import { Layout } from '~/web/layout';
import { GrantForm } from './form';
import { MemberPicker, RolePicker } from './picker';

interface Props {
  roles: RoleInfo[];
  member: string | undefined;
  memberMatches: MemberInfo[] | undefined;
  checkMatches: MemberInfo[] | undefined;
  counts: ReadonlyMap<string, number>;
  subject: { type: GrantSubject; id: string; name: string } | undefined;
  granted: ReadonlySet<string>;
  access:
    | ReadonlyArray<{ permission: PermissionDefinition; sources: string[] }>
    | undefined;
  checked: string | undefined;
  catalogue: PermissionDefinition[];
  advanced: boolean;
  toggle: string;
  delegation: boolean;
  can: ReadonlySet<Permission>;
  flash: Flash;
}

export function PermissionPage({
  roles,
  member,
  memberMatches,
  checkMatches,
  counts,
  subject,
  granted,
  access,
  checked,
  catalogue,
  advanced,
  toggle,
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
        <a href={toggle}>{advanced ? 'Hide advanced' : 'Show advanced'}</a>
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
        <MemberPicker
          name="member"
          label="Member grants"
          query={member}
          matches={memberMatches}
        />
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
          <MemberPicker
            name="check"
            label="Member"
            query={checked}
            matches={checkMatches}
          />
          <script src="/combobox.js" defer />
          {access ? (
            <div class="table-wrapper" tabIndex={0}>
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
            </div>
          ) : null}
        </>
      ) : null}
    </Layout>
  );
}
