import type { Actor } from '~/core/actor';
import { UserError } from '~/core/errors';
import { managePermissions, type Permission } from '~/core/permission';

export interface Delegation {
  actor: Actor;
  rolePosition: number;
  permission: Permission;
  actorHolds: boolean;
}

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
