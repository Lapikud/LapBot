import {
  checkDelegation,
  managePermissions,
  type Permission,
  type PermissionDefinition,
} from '~/core/permission';
import { UserError } from '~/core/errors';
import type { Actor } from '~/core/actor';
import { type Authorizer, guard } from '~/core/authorization';
import type { Directory } from '~/core/directory';
import type { Logger } from '~/core/logger';
import type { GrantRepository } from './model';

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

  const grant = change('grant');
  const revoke = change('revoke');

  return {
    catalogue: () => [...known().values()],
    grant,
    revoke,
    list: guard(authz, managePermissions, (actor, roleId?: string) =>
      grants.list(actor.guildId, roleId),
    ),
    setRole: guard(
      authz,
      managePermissions,
      async (actor, roleId: string, wanted: readonly string[]) => {
        const target = new Set(wanted.map((value) => definition(value).id));
        const granted = await grants.list(actor.guildId, roleId);
        const current = new Set(granted.map((g) => g.permission));
        const toGrant = [...target].filter((p) => !current.has(p));
        const toRevoke = [...known().keys()].filter(
          (p) => current.has(p) && !target.has(p),
        );

        const role = await directory.role(actor.guildId, roleId);

        if (!role) {
          throw new UserError('That role does not exist.');
        }

        await Promise.all(
          [...toGrant, ...toRevoke].map(async (permission) => {
            checkDelegation({
              actor,
              rolePosition: role.position,
              permission,
              actorHolds: await authz.can(actor, permission),
            });
          }),
        );

        await grants.apply({
          guildId: actor.guildId,
          roleId,
          grantedBy: actor.userId,
          grant: toGrant,
          revoke: toRevoke,
        });
        log.info(
          {
            guildId: actor.guildId,
            roleId,
            actorId: actor.userId,
            granted: toGrant,
            revoked: toRevoke,
          },
          'Permission replacement',
        );

        return { granted: toGrant.length, revoked: toRevoke.length };
      },
    ),
  };
}

export type PermissionService = ReturnType<typeof createPermissionService>;
