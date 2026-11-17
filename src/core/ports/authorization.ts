import type { Actor } from '~/core/actor';
import type { Permission } from '~/core/permission';

export type Authorizer = {
  can: (actor: Actor, permission: Permission) => Promise<boolean>;
  require: (actor: Actor, permission: Permission) => Promise<void>;
};
