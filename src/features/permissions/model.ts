import type { Permission } from '~/core/permission';

export interface Grant {
  roleId: string;
  permission: string;
}

export interface GrantChange {
  guildId: string;
  roleId: string;
  permission: Permission;
}

export interface GrantRepository {
  holds: (
    guildId: string,
    roleIds: readonly string[],
    permission: Permission,
  ) => Promise<boolean>;
  held: (guildId: string, roleIds: readonly string[]) => Promise<string[]>;
  grant: (change: GrantChange & { grantedBy: string }) => Promise<boolean>;
  revoke: (change: GrantChange) => Promise<boolean>;
  apply: (input: {
    guildId: string;
    roleId: string;
    grantedBy: string;
    grant: readonly Permission[];
    revoke: readonly Permission[];
  }) => Promise<void>;
  list: (guildId: string, roleId?: string) => Promise<Grant[]>;
}
