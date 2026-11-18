export interface Actor {
  guildId: string;
  userId: string;
  roleIds: readonly string[];
  administrator: boolean;
  owner: boolean;
  highestRolePosition: number;
}
