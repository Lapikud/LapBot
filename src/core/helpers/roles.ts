import { UserError } from '~/core/errors';
import type { RoleInfo } from '~/core/ports/directory';

export function selfAssignProblem(role: RoleInfo): string | undefined {
  if (role.everyone) {
    return 'is the @everyone role';
  }

  if (role.managed) {
    return 'is managed by an integration';
  }

  if (role.moderator) {
    return 'grants moderator permissions';
  }

  if (!role.botCanAssign) {
    return 'is above my highest role, or I lack Manage Roles';
  }

  return undefined;
}

export function requireManageable(role: RoleInfo): void {
  if (role.managed || !role.botCanAssign) {
    throw new UserError(
      `I cannot manage ${role.name}: it is managed or above my highest role.`,
    );
  }
}

export function requireMentionable(role: RoleInfo): void {
  if (role.everyone || !role.mentionable) {
    throw new UserError('You may not mention that role.');
  }
}
