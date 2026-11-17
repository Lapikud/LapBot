import type { BirthdayVisibility } from './rules';

export type Birthday = {
  guildId: string;
  userId: string;
  month: number;
  day: number;
  visibility: BirthdayVisibility;
  lastAnnouncedYear: number | null;
};

export type BirthdaySettings = {
  guildId: string;
  channelId: string;
  roleId: string | null;
  hour: number;
};
