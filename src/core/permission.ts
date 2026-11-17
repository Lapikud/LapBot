export type Permission = `${string}:${string}`;

export interface PermissionDefinition {
  id: Permission;
  description: string;
  group?: string;
}

export const managePermissions: Permission = 'permissions:manage';

export const webAccess: Permission = 'web:access';

// Internal navigation capability, never assignable through grants.
export const applicationAdmin: Permission = 'application:administrator';
