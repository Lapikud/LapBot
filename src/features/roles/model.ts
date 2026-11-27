export type PanelKind = 'reaction' | 'select';

export interface PanelRole {
  roleId: string;
  label: string;
  emoji: string | null;
}

export interface NewPanel {
  guildId: string;
  channelId: string;
  kind: PanelKind;
  title: string;
  createdBy: string;
}

export interface ReactionKey {
  guildId: string;
  channelId: string;
  messageId: string;
  emoji: string;
}

export interface RolePanel extends NewPanel {
  id: number;
  messageId: string | null;
  roles: PanelRole[];
}

export interface RolePanelRepository {
  list: (guildId: string) => Promise<RolePanel[]>;
  reactionRole: (key: ReactionKey) => Promise<string | undefined>;
  create: (panel: NewPanel) => Promise<number>;
  setMessage: (id: number, messageId: string | null) => Promise<void>;
  replaceRoles: (id: number, roles: readonly PanelRole[]) => Promise<void>;
  remove: (id: number) => Promise<void>;
}
