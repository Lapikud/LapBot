import { requireZone } from '~/domain';
import type { Authorizer, SettingsRepository } from '~/core/ports';
import { guard } from './guard';

type Deps = {
  settings: SettingsRepository;
  authz: Authorizer;
  defaultTimezone: string;
};

export function createSettingsService({
  settings,
  authz,
  defaultTimezone,
}: Deps) {
  return {
    timezone: async (guildId: string) =>
      (await settings.timezone(guildId)) ?? defaultTimezone,
    setTimezone: guard(authz, 'settings:manage', (actor, zone: string) =>
      settings.setTimezone(actor.guildId, requireZone(zone)),
    ),
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
