import type { Birthday, BirthdaySettings } from '~/domain/birthdays';
import type { CalendarDay } from '~/domain';
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
