import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  type Client,
} from 'discord.js';
import type { Calendar } from '~/core/calendar';

export function createDiscordCalendar(client: Client): Calendar {
  return {
    upsert: async (guildId, id, event) => {
      const guild = await client.guilds.fetch(guildId);
      const details = {
        name: event.title.slice(0, 100),
        scheduledStartTime: event.startsAt,
        scheduledEndTime: event.endsAt,
        description: event.description.slice(0, 1000),
        entityMetadata: { location: event.location.slice(0, 100) },
      };

      if (id !== null) {
        await guild.scheduledEvents.edit(id, details);

        return id;
      }

      const created = await guild.scheduledEvents.create({
        ...details,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.External,
      });

      return created.id;
    },
    remove: async (guildId, id) => {
      const guild = await client.guilds.fetch(guildId);

      await guild.scheduledEvents.delete(id);
    },
  };
}
