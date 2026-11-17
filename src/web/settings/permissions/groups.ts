import type { PermissionDefinition } from '~/core/permission';
import type { RoleInfo } from '~/core/ports/directory';

export const title = (name: string) =>
  `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

export function groupsOf(catalogue: readonly PermissionDefinition[]) {
  const groups = new Map<string, PermissionDefinition[]>();

  for (const permission of catalogue) {
    const group = title(permission.group ?? 'other');

    groups.set(group, [...(groups.get(group) ?? []), permission]);
  }

  return [...groups];
}

export const roleName = (role: RoleInfo) =>
  role.everyone ? 'Everyone' : `@${role.name}`;
