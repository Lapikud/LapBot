export type SettingsRepository = {
  timezone: (guildId: string) => Promise<string | undefined>;
  setTimezone: (guildId: string, timezone: string) => Promise<void>;
};
