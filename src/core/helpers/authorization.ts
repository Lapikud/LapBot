import type { Actor } from '~/core/actor';
import type { Permission } from '~/core/permission';
import type { Authorizer } from '~/core/ports/authorization';

export function guard<Args extends unknown[], Result>(
  authz: Authorizer,
  permission: Permission | readonly [Permission, ...Permission[]],
  method: (actor: Actor, ...args: Args) => Promise<Result>,
): (actor: Actor, ...args: Args) => Promise<Result> {
  return async (actor, ...args) => {
    const [needed, ...others] =
      typeof permission === 'string' ? [permission] : permission;
    const held =
      others.length === 0 ? new Set() : await authz.granted(actor, others);

    if (held.size === 0) {
      await authz.require(actor, needed);
    }

    return method(actor, ...args);
  };
}
