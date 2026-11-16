export type PanelKind = 'reaction' | 'select';

export type PanelRole = {
  roleId: string;
  label: string;
  emoji: string | null;
};

export type NewPanel = {
  guildId: string;
  channelId: string;
  kind: PanelKind;
  title: string;
  createdBy: string;
};

export type ReactionKey = {
  guildId: string;
  channelId: string;
  messageId: string;
  emoji: string;
};

export type RolePanelRepository = {
  reactionRole: (key: ReactionKey) => Promise<string | undefined>;
  create: (panel: NewPanel) => Promise<number>;
  reactionPanel: (
    guildId: string,
    channelId: string,
  ) => Promise<{ id: number; messageId: string | null } | undefined>;
  setMessage: (id: number, messageId: string | null) => Promise<void>;
  replaceRoles: (id: number, roles: readonly PanelRole[]) => Promise<void>;
};
