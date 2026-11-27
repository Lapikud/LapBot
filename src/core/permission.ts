export type Permission = `${string}:${string}`;

export interface PermissionDefinition {
  id: Permission;
  description: string;
  group?: string;
  partOf?: Permission;
  advanced?: boolean;
}

export const delegation = (permission: Permission): Permission =>
  `delegate:${permission}`;

export const announcementParts: readonly Permission[] = [
  'announcement:create',
  'announcement:publish',
  'announcement:schedule',
];

export const holdsAny = (
  can: ReadonlySet<Permission>,
  needs: Permission | readonly Permission[],
) => [needs].flat().some((permission) => can.has(permission));

export const managePermissions: Permission = 'permissions:manage';

export const webAccess: Permission = 'web:access';

// Internal navigation capability, never assignable through grants.
export const applicationAdmin: Permission = 'application:administrator';
