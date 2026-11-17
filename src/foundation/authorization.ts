import type { Actor } from './actor';
import type { Permission } from './permission';

export type Authorizer = {
  can: (actor: Actor, permission: Permission) => Promise<boolean>;
  require: (actor: Actor, permission: Permission) => Promise<void>;
};

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
