import type { Permission } from '~/foundation/permission';

export type Grant = { roleId: string; permission: string };

export type GrantChange = {
  guildId: string;
  roleId: string;
  permission: Permission;
};

export type GrantRepository = {
  holds: (
    guildId: string,
    roleIds: readonly string[],
    permission: Permission,
  ) => Promise<boolean>;
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
};
