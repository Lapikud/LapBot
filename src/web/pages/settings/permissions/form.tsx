import type { PermissionDefinition } from '~/core/permission';
import type { GrantSubject } from '~/features/permissions/model';
import { groupsOf } from './groups';

interface Props {
  subject: { type: GrantSubject; id: string; name: string };
  granted: ReadonlySet<string>;
  catalogue: readonly PermissionDefinition[];
  advanced: boolean;
  delegation: boolean;
}

const bundleFirst = (a: PermissionDefinition, b: PermissionDefinition) =>
  (a.partOf ?? a.id).localeCompare(b.partOf ?? b.id) ||
  Number(a.partOf !== undefined) - Number(b.partOf !== undefined);

function Toggle({
  value,
  label,
  checked,
}: Readonly<{ value: string; label: string; checked: boolean }>) {
  return (
    <>
      <input
        type="checkbox"
        name="permission"
        value={value}
        checked={checked}
        aria-label={label}
      />
      <input type="hidden" name="shown" value={value} />
    </>
  );
}

export function GrantForm({
  subject,
  granted,
  catalogue,
  advanced,
  delegation,
}: Readonly<Props>) {
  const shown = catalogue.filter(
    (permission) => advanced || permission.partOf === undefined,
  );

  return (
    <form
      method="post"
      action={`/settings/permissions/${subject.type}/${subject.id}${advanced ? '?advanced=1' : ''}`}
    >
      <h2>{subject.name}</h2>
      <table>
        <thead>
          <tr>
            <th>Permission</th>
            <th>Has</th>
            {delegation ? <th>Can hand out</th> : null}
          </tr>
        </thead>
        {groupsOf(shown).map(([group, permissions]) => (
          <tbody key={group}>
            <tr>
              <th colspan={delegation ? 3 : 2}>{group}</th>
            </tr>
            {permissions.toSorted(bundleFirst).map((permission) => (
              <tr key={permission.id}>
                <td
                  class={permission.partOf === undefined ? undefined : 'part'}
                >
                  {permission.description} <small>{permission.id}</small>
                  {permission.partOf !== undefined &&
                  granted.has(permission.partOf) ? (
                    <small> · included</small>
                  ) : null}
                </td>
                <td>
                  <Toggle
                    value={permission.id}
                    label={`${subject.name} has ${permission.id}`}
                    checked={granted.has(permission.id)}
                  />
                </td>
                {delegation ? (
                  <td>
                    <Toggle
                      value={`delegate:${permission.id}`}
                      label={`${subject.name} can hand out ${permission.id}`}
                      checked={granted.has(`delegate:${permission.id}`)}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <button type="submit">Save</button>
    </form>
  );
}
