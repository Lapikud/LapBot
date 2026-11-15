export type Actor = {
  guildId: string;
  userId: string;
  roleIds: readonly string[];
  administrator: boolean;
  owner: boolean;
  mentionEveryone: boolean;
  highestRolePosition: number;
};
