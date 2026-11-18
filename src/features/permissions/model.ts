import type { Permission } from '~/core/permission';

export type GrantSubject = 'role' | 'user';

export interface Grant {
  subjectType?: GrantSubject;
  roleId: string;
  permission: string;
}

export interface GrantChange {
  subjectType?: GrantSubject;
  guildId: string;
  roleId: string;
  permission: Permission;
}

export interface GrantRepository {
  holds: (
    guildId: string,
    roleIds: readonly string[],
    permission: Permission,
    userId?: string,
  ) => Promise<boolean>;
  held: (
    guildId: string,
    roleIds: readonly string[],
    userId?: string,
  ) => Promise<string[]>;
  grant: (change: GrantChange & { grantedBy: string }) => Promise<boolean>;
  revoke: (change: GrantChange) => Promise<boolean>;
  apply: (input: {
    guildId: string;
    roleId: string;
    subjectType?: GrantSubject;
    grantedBy: string;
    grant: readonly Permission[];
    revoke: readonly Permission[];
  }) => Promise<void>;
  list: (
    guildId: string,
    roleId?: string,
    subjectType?: GrantSubject,
  ) => Promise<Grant[]>;
}
