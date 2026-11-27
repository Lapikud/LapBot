import type { MemberInfo, RoleInfo } from '~/core/ports/directory';
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
  query,
  matches,
}: Readonly<{
  name: string;
  label: string;
  query: string | undefined;
  matches: MemberInfo[] | undefined;
}>) {
  return (
    <>
      <form method="get" action="/settings/permissions">
        <input type="hidden" name="advanced" value="1" />
        <label htmlFor={name}>{label}</label>
        <div class="combobox">
          <fieldset role="group">
            <input
              id={name}
              name={name}
              value={query}
              placeholder="Name, username or member ID"
              autocomplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="false"
              aria-controls={`${name}-options`}
              data-source="/settings/permissions/members"
              required
            />
            <button type="submit" class="secondary">
              Open
            </button>
          </fieldset>
          <ul
            id={`${name}-options`}
            role="listbox"
            aria-label={`${label} suggestions`}
            hidden
          />
        </div>
      </form>
      {matches === undefined ? null : (
        <MemberMatches
          name={name}
          label={label}
          query={query}
          matches={matches}
        />
      )}
    </>
  );
}

function MemberMatches({
  name,
  label,
  query,
  matches,
}: Readonly<{
  name: string;
  label: string;
  query: string | undefined;
  matches: MemberInfo[];
}>) {
  if (matches.length === 0) {
    return <p class="hint">No members match “{query}”.</p>;
  }

  return (
    <ul aria-label={`${label} results`}>
      {matches.map((member) => (
        <li key={member.id}>
          <a href={`?advanced=1&${name}=${member.id}`}>{member.name}</a>{' '}
          <small>{member.username}</small>
        </li>
      ))}
    </ul>
  );
}

export function findMembers(
  members: MemberInfo[],
  query: string | undefined,
): MemberInfo[] | undefined {
  const text = query?.trim().toLowerCase();

  return text === undefined || text === ''
    ? undefined
    : members.filter(({ name, username }) =>
        [name, username].some((value) => value.toLowerCase().includes(text)),
      );
}
