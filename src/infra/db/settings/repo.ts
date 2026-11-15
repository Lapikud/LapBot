import { eq } from 'drizzle-orm';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { Db } from '../client';

export const guildSettings = pgTable('guild_settings', {
  guildId: text('guild_id').primaryKey(),
  timezone: text('timezone'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export async function getGuildTimezone(
  db: Db,
  guildId: string,
  fallback: string,
): Promise<string> {
  const [row] = await db
    .select({ timezone: guildSettings.timezone })
    .from(guildSettings)
    .where(eq(guildSettings.guildId, guildId));

  return row?.timezone ?? fallback;
}

export async function setGuildTimezone(
  db: Db,
  guildId: string,
  timezone: string,
): Promise<void> {
  await db
    .insert(guildSettings)
    .values({ guildId, timezone })
    .onConflictDoUpdate({
      target: guildSettings.guildId,
      set: { timezone, updatedAt: new Date() },
    });
}
