import { checkDelegation } from '~/core/helpers/permissions';
import {
  applicationAdmin,
  managePermissions,
  type Permission,
  type PermissionDefinition,
} from '~/core/permission';
import { UserError } from '~/core/errors';
import type { Actor } from '~/core/actor';
import { type Authorizer } from '~/core/ports/authorization';
import { guard } from '~/core/helpers/authorization';
import type { Directory } from '~/core/ports/directory';
import type { Logger } from '~/core/ports/logger';
import type { GrantRepository, GrantSubject } from './model';

export function createAuthorizer(
  grants: GrantRepository,
  known: () => ReadonlyMap<Permission, PermissionDefinition> = () =>
    new Map<Permission, PermissionDefinition>(),
): Authorizer {
  const sources = (permission: Permission) => {
    const bundle = known().get(permission)?.partOf;

    return bundle === undefined ? [permission] : [permission, bundle];
  };

  const can = async (actor: Actor, permission: Permission) => {
    if (actor.administrator) {
      return true;
    }

    if (permission === applicationAdmin) {
      return false;
    }

    const held = await Promise.all(
      sources(permission).map((source) =>
        grants.holds(actor.guildId, actor.roleIds, source, actor.userId),
      ),
    );

    return held.includes(true);
  };

  return {
    can,
    require: async (actor, permission) => {
      if (!(await can(actor, permission))) {
        throw new UserError(
          `You need the "${permission}" permission for this.`,
        );
      }
    },
    granted: async (actor, permissions) => {
      if (actor.administrator) {
        return new Set(permissions);
      }

      const held = new Set(
        await grants.held(actor.guildId, actor.roleIds, actor.userId),
      );

      return new Set(
        permissions.filter(
          (permission) =>
            permission !== applicationAdmin &&
            sources(permission).some((source) => held.has(source)),
        ),
      );
    },
  };
}

interface Deps {
  grants: GrantRepository;
  directory: Directory;
  authz: Authorizer;
  log: Logger;
  known: () => ReadonlyMap<Permission, PermissionDefinition>;
}

export function createPermissionService(deps: Deps) {
  const { grants, directory, authz, log, known } = deps;

  const definition = (value: string): PermissionDefinition => {
    if (value === applicationAdmin) {
      throw new UserError(
        'Application administrator access cannot be granted as a bot permission.',
      );
    }

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
      async (
        actor,
        roleId: string,
        value: string,
        subjectType: GrantSubject = 'role',
      ) => {
        const { id: permission } = definition(value);
        const role =
          subjectType === 'user'
            ? await directory
                .member(actor.guildId, roleId)
                .then(
                  (member) =>
                    member && { position: member.highestRolePosition },
                )
            : await directory.role(actor.guildId, roleId);

        if (!role) {
          throw new UserError('That member or role does not exist.');
        }

        checkDelegation({
          actor,
          rolePosition: role.position,
          permission,
          actorHolds: await authz.can(actor, permission),
        });

        const input = {
          guildId: actor.guildId,
          roleId,
          permission,
          subjectType,
        };
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
    list: guard(
      authz,
      managePermissions,
      (actor, roleId?: string, subjectType?: GrantSubject) =>
        grants.list(actor.guildId, roleId, subjectType),
    ),
    setRole: guard(
      authz,
      managePermissions,
      async (actor, roleId: string, wanted: readonly string[]) => {
        const target = new Set(wanted.map((value) => definition(value).id));
        const granted = await grants.list(actor.guildId, roleId, 'role');
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
