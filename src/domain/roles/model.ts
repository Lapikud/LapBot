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

export type RolePanel = NewPanel & {
  id: number;
  messageId: string | null;
  roles: PanelRole[];
};
