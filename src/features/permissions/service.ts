import { checkDelegation } from '~/core/helpers/permissions';
import {
  applicationAdmin,
  delegation,
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

    const inner = value.startsWith('delegate:') ? value.slice(9) : value;
    const found = [...known().values()].find((p) => p.id === inner);

    if (!found) {
      throw new UserError(`Unknown permission "${value}".`);
    }

    return inner === value
      ? found
      : {
          id: delegation(found.id),
          description: `Hand out: ${found.description}`,
        };
  };

  const positionOf = async (
    actor: Actor,
    subjectType: GrantSubject,
    id: string,
  ) => {
    const [member, role] =
      subjectType === 'user'
        ? [await directory.member(actor.guildId, id), undefined]
        : [undefined, await directory.role(actor.guildId, id)];
    const position = member?.highestRolePosition ?? role?.position;

    if (position === undefined) {
      throw new UserError('That member or role does not exist.');
    }

    return position;
  };

  const mayHandOut = async (actor: Actor, permission: Permission) =>
    (await authz.can(actor, permission)) ||
    (!permission.startsWith('delegate:') &&
      (await authz.can(actor, delegation(permission))));

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

        checkDelegation({
          actor,
          rolePosition: await positionOf(actor, subjectType, roleId),
          permission,
          actorHolds: await mayHandOut(actor, permission),
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
    setGrants: guard(
      authz,
      managePermissions,
      async (
        actor,
        subject: { type: GrantSubject; id: string },
        wanted: readonly string[],
        shown: readonly string[],
      ) => {
        const scope = new Set(shown.map((value) => definition(value).id));
        const target = new Set(
          wanted
            .map((value) => definition(value).id)
            .filter((permission) => scope.has(permission)),
        );
        const held = await grants.list(actor.guildId, subject.id, subject.type);
        const current = new Set(held.map((g) => g.permission));
        const toGrant = [...target].filter((p) => !current.has(p));
        const toRevoke = [...scope].filter(
          (p) => current.has(p) && !target.has(p),
        );
        const position = await positionOf(actor, subject.type, subject.id);

        await Promise.all(
          [...toGrant, ...toRevoke].map(async (permission) => {
            checkDelegation({
              actor,
              rolePosition: position,
              permission,
              actorHolds: await mayHandOut(actor, permission),
            });
          }),
        );

        await grants.apply({
          guildId: actor.guildId,
          roleId: subject.id,
          subjectType: subject.type,
          grantedBy: actor.userId,
          grant: toGrant,
          revoke: toRevoke,
        });
        log.info(
          {
            guildId: actor.guildId,
            subject,
            actorId: actor.userId,
            granted: toGrant,
            revoked: toRevoke,
          },
          'Permission replacement',
        );

        return { granted: toGrant.length, revoked: toRevoke.length };
      },
    ),
    explain: guard(authz, managePermissions, async (actor, userId: string) => {
      const member = await directory.member(actor.guildId, userId);

      if (!member) {
        throw new UserError('That member is not in the server.');
      }

      const [all, roles] = await Promise.all([
        grants.list(actor.guildId),
        directory.roles(actor.guildId),
      ]);
      const names = new Map(
        roles.map((role) => [
          role.id,
          role.everyone ? 'Everyone' : `@${role.name}`,
        ]),
      );
      const mine = all.filter((held) =>
        held.subjectType === 'user'
          ? held.roleId === userId
          : member.roleIds.includes(held.roleId),
      );
      const source = (held: (typeof all)[number]) =>
        held.subjectType === 'user'
          ? 'Personal'
          : (names.get(held.roleId) ?? 'a deleted role');

      return [...known().values()].map((permission) => ({
        permission,
        sources: member.administrator
          ? ['Administrator']
          : mine
              .filter(
                (held) =>
                  held.permission === permission.id ||
                  held.permission === permission.partOf,
              )
              .map((held) =>
                held.permission === permission.id
                  ? source(held)
                  : `${source(held)} (${held.permission})`,
              ),
      }));
    }),
  };
}

export type PermissionService = ReturnType<typeof createPermissionService>;
