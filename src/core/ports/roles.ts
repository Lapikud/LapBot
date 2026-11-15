export type PanelKind = 'reaction' | 'select';

export type PanelRole = {
  roleId: string;
  label: string;
  emoji: string | null;
};

export type RolePanel = {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  kind: PanelKind;
  title: string;
  roles: PanelRole[];
};

export type PanelSummary = Pick<
  RolePanel,
  'id' | 'title' | 'kind' | 'channelId'
>;

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
  find: (guildId: string, id: number) => Promise<RolePanel | undefined>;
  list: (guildId: string) => Promise<PanelSummary[]>;
  selfAssignable: (guildId: string) => Promise<string[]>;
  create: (panel: NewPanel) => Promise<number>;
  reactionPanel: (
    guildId: string,
    channelId: string,
  ) => Promise<{ id: number; messageId: string | null } | undefined>;
  setMessage: (id: number, messageId: string | null) => Promise<void>;
  setTitle: (id: number, title: string) => Promise<void>;
  replaceRoles: (id: number, roles: readonly PanelRole[]) => Promise<void>;
  addRole: (id: number, role: PanelRole) => Promise<void>;
  removeRole: (id: number, roleId: string) => Promise<boolean>;
  remove: (id: number) => Promise<void>;
};
