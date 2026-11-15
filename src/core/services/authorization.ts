import {
  checkDelegation,
  managePermissions,
  UserError,
  type Actor,
  type Permission,
  type PermissionDefinition,
} from '~/domain';
import type {
  Authorizer,
  Directory,
  GrantRepository,
  Logger,
} from '~/core/ports';
import { guard } from './guard';

export function createAuthorizer(grants: GrantRepository): Authorizer {
  const can = async (actor: Actor, permission: Permission) =>
    actor.administrator ||
    grants.holds(actor.guildId, actor.roleIds, permission);

  return {
    can,
    require: async (actor, permission) => {
      if (!(await can(actor, permission))) {
        throw new UserError(
          `You need the "${permission}" permission for this.`,
        );
      }
    },
  };
}

type Deps = {
  grants: GrantRepository;
  directory: Directory;
  authz: Authorizer;
  log: Logger;
  known: () => ReadonlyMap<Permission, PermissionDefinition>;
};

export function createPermissionService(deps: Deps) {
  const { grants, directory, authz, log, known } = deps;

  const definition = (value: string): PermissionDefinition => {
    const found = [...known().values()].find((p) => p.id === value);

    if (!found) {
      throw new UserError(`Unknown permission "${value}".`);
    }

    return found;
  };

  const change = (action: 'grant' | 'revoke') =>
    guard(
      authz,
      managePermissions,
      async (actor, roleId: string, value: string) => {
        const { id: permission } = definition(value);
        const role = await directory.role(actor.guildId, roleId);

        if (!role) {
          throw new UserError('That role does not exist.');
        }

        checkDelegation({
          actor,
          rolePosition: role.position,
          permission,
          actorHolds: await authz.can(actor, permission),
        });

        const input = { guildId: actor.guildId, roleId, permission };
        const changed =
          action === 'grant'
            ? await grants.grant({ ...input, grantedBy: actor.userId })
            : await grants.revoke(input);

        log.info(
          { ...input, actorId: actor.userId, action, changed },
          'Permission change',
        );

        return changed;
      },
    );

  return {
    catalogue: () => [...known().values()],
    grant: change('grant'),
    revoke: change('revoke'),
    list: guard(authz, managePermissions, (actor, roleId?: string) =>
      grants.list(actor.guildId, roleId),
    ),
    check: guard(
      authz,
      managePermissions,
      async (actor, userId: string, value: string) => {
        const member = await directory.member(actor.guildId, userId);

        return member !== undefined && authz.can(member, definition(value).id);
      },
    ),
  };
}

export type PermissionService = ReturnType<typeof createPermissionService>;
