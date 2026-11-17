import type { RoleInfo } from '~/core/ports/directory';
import { FormActions } from '~/web/components/actions';
import { roleName } from './groups';

export function RolePicker({
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
