import type { Actor } from './actor';
import { UserError } from './errors';

export type Permission = `${string}:${string}`;

export type PermissionDefinition = {
  id: Permission;
  description: string;
  group?: string;
};

export const managePermissions: Permission = 'permissions:manage';

export const webAccess: Permission = 'web:access';

export type Delegation = {
  actor: Actor;
  rolePosition: number;
  permission: Permission;
  actorHolds: boolean;
};

export function checkDelegation(delegation: Delegation): void {
  const { actor, rolePosition, permission, actorHolds } = delegation;

  if (actor.administrator) {
    return;
  }

  if (permission === managePermissions) {
    throw new UserError(
      'Only administrators can delegate permission management.',
    );
  }

  if (actor.highestRolePosition <= rolePosition) {
    throw new UserError('That role is not below your highest role.');
  }

  if (!actorHolds) {
    throw new UserError('You can only grant permissions you hold yourself.');
  }
}
