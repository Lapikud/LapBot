import type { Actor, Permission } from '~/domain';
export type Authorizer = {
  can: (actor: Actor, permission: Permission) => Promise<boolean>;
  require: (actor: Actor, permission: Permission) => Promise<void>;
};
