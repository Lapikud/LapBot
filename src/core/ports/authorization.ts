import type { Actor } from '~/core/actor';
import type { Permission } from '~/core/permission';

export interface Authorizer {
  can: (actor: Actor, permission: Permission) => Promise<boolean>;
  require: (actor: Actor, permission: Permission) => Promise<void>;
  granted: (
    actor: Actor,
    permissions: readonly Permission[],
  ) => Promise<Set<Permission>>;
}
