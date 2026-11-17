export type Permission = `${string}:${string}`;

export interface PermissionDefinition {
  id: Permission;
  description: string;
  group?: string;
}

export const managePermissions: Permission = 'permissions:manage';

export const webAccess: Permission = 'web:access';
