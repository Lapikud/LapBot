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
import { sequential } from '~/lib';
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

        await sequential(toGrant, (p) => grant(actor, roleId, p));
        await sequential(toRevoke, (p) => revoke(actor, roleId, p));

        return { granted: toGrant.length, revoked: toRevoke.length };
      },
    ),
  };
}

export type PermissionService = ReturnType<typeof createPermissionService>;
