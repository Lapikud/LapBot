import { and, eq, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import type { BirthdayRepository } from '~/features/birthdays/model';
import type { Db } from '../client';
import { celebratedOn, validateBirthday } from '~/features/birthdays/rules';
import { birthdays, birthdaySettings } from './table';

export function createBirthdayRepository(db: Db): BirthdayRepository {
  return {
    set: async (input) => {
      validateBirthday(input.month, input.day);
      await db
        .insert(birthdays)
        .values(input)
        .onConflictDoUpdate({
          target: [birthdays.guildId, birthdays.userId],
          set: {
            month: input.month,
            day: input.day,
            visibility: input.visibility,
          },
        });
    },
    remove: async (guildId, userId) => {
      const rows = await db
        .delete(birthdays)
        .where(
          and(eq(birthdays.guildId, guildId), eq(birthdays.userId, userId)),
        )
        .returning({ userId: birthdays.userId });

      return rows.length > 0;
    },
    find: async (guildId, userId) => {
      const [row] = await db
        .select()
        .from(birthdays)
        .where(
          and(eq(birthdays.guildId, guildId), eq(birthdays.userId, userId)),
        );

      return row;
    },
    upcoming: async (guildId, today, limit = 10) => {
      const rows = await db
        .select()
        .from(birthdays)
        .where(
          and(
            eq(birthdays.guildId, guildId),
            eq(birthdays.visibility, 'public'),
          ),
        )
        .limit(2000);
      const key = (b: { month: number; day: number }) => b.month * 100 + b.day;
      const start = key(today);

      return rows
        .toSorted((a, b) => {
          const ka = (key(a) - start + 1300) % 1300;
          const kb = (key(b) - start + 1300) % 1300;

          return ka - kb;
        })
        .slice(0, limit);
    },
    claim: async (guildId, today) => {
      const dates = celebratedOn(today);
      const rows = await db
        .update(birthdays)
        .set({ lastAnnouncedYear: today.year })
        .where(
          and(
            eq(birthdays.guildId, guildId),
            ne(birthdays.visibility, 'private'),
            or(
              ...dates.map((d) =>
                and(eq(birthdays.month, d.month), eq(birthdays.day, d.day)),
              ),
            ),
            or(
              isNull(birthdays.lastAnnouncedYear),
              lt(birthdays.lastAnnouncedYear, today.year),
            ),
          ),
        )
        .returning({ userId: birthdays.userId });

      return rows.map((row) => row.userId);
    },
    release: async (guildId, userIds, year) => {
      if (userIds.length === 0) {
        return;
      }

      await db
        .update(birthdays)
        .set({ lastAnnouncedYear: year - 1 })
        .where(
          and(
            eq(birthdays.guildId, guildId),
            inArray(birthdays.userId, userIds),
            eq(birthdays.lastAnnouncedYear, year),
          ),
        );
    },
    settings: async (guildId) => {
      const [row] = await db
        .select()
        .from(birthdaySettings)
        .where(eq(birthdaySettings.guildId, guildId));

      return row;
    },
    saveSettings: async (settings) => {
      await db.insert(birthdaySettings).values(settings).onConflictDoUpdate({
        target: birthdaySettings.guildId,
        set: settings,
      });
    },
    deleteSettings: async (guildId) => {
      await db
        .delete(birthdaySettings)
        .where(eq(birthdaySettings.guildId, guildId));
    },
  };
}
