import type { RoleInfo } from '~/core/ports/directory';
import { roleName } from './groups';

export function RolePicker({
  roles,
  selected,
  counts,
  advanced,
}: Readonly<{
  roles: RoleInfo[];
  selected: string | undefined;
  counts: ReadonlyMap<string, number>;
  advanced: boolean;
}>) {
  return (
    <form method="get" action="/settings/permissions">
      {advanced ? <input type="hidden" name="advanced" value="1" /> : null}
      <label htmlFor="role">Role</label>
      <fieldset role="group">
        <select id="role" name="role" required>
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
      </fieldset>
    </form>
  );
}

export function MemberPicker({
  name,
  label,
  selected,
}: Readonly<{
  name: string;
  label: string;
  selected: string | undefined;
}>) {
  return (
    <form method="get" action="/settings/permissions">
      <input type="hidden" name="advanced" value="1" />
      <label htmlFor={name}>{label}</label>
      <fieldset role="group">
        <input
          id={name}
          name={name}
          list="permission-members"
          value={selected}
          placeholder="Name or member ID"
          pattern="[0-9]{17,20}"
          required
        />
        <button type="submit" class="secondary">
          Open
        </button>
      </fieldset>
    </form>
  );
}
