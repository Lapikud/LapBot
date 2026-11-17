import type {
  PanelRole,
  NewPanel,
  ReactionKey,
  RolePanel,
} from '~/domain/roles';
export type RolePanelRepository = {
  list: (guildId: string) => Promise<RolePanel[]>;
  reactionRole: (key: ReactionKey) => Promise<string | undefined>;
  create: (panel: NewPanel) => Promise<number>;
  reactionPanel: (
    guildId: string,
    channelId: string,
  ) => Promise<{ id: number; messageId: string | null } | undefined>;
  setMessage: (id: number, messageId: string | null) => Promise<void>;
  replaceRoles: (id: number, roles: readonly PanelRole[]) => Promise<void>;
};
