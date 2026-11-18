import type { Actor } from '~/core/actor';
import type { Permission } from '~/core/permission';
import type { Authorizer } from '~/core/ports/authorization';

export function guard<Args extends unknown[], Result>(
  authz: Authorizer,
  permission: Permission,
  method: (actor: Actor, ...args: Args) => Promise<Result>,
): (actor: Actor, ...args: Args) => Promise<Result> {
  return async (actor, ...args) => {
    await authz.require(actor, permission);

    return method(actor, ...args);
  };
}
