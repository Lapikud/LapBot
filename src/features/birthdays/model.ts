import type { BirthdayVisibility } from './rules';
import type { CalendarDay } from '~/core/time';

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

export type BirthdayRepository = {
  set: (birthday: Omit<Birthday, 'lastAnnouncedYear'>) => Promise<void>;
  remove: (guildId: string, userId: string) => Promise<boolean>;
  find: (guildId: string, userId: string) => Promise<Birthday | undefined>;
  upcoming: (
    guildId: string,
    today: CalendarDay,
    limit?: number,
  ) => Promise<Birthday[]>;
  claim: (guildId: string, today: CalendarDay) => Promise<string[]>;
  release: (guildId: string, userIds: string[], year: number) => Promise<void>;
  settings: (guildId: string) => Promise<BirthdaySettings | undefined>;
  saveSettings: (settings: BirthdaySettings) => Promise<void>;
  deleteSettings: (guildId: string) => Promise<void>;
};
