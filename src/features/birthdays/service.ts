import { and, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Db } from '../../db/client.js';
import { UserError } from '../../shared/errors.js';
import {
  birthdays,
  birthdaySettings,
  type Birthday,
  type BirthdayVisibility,
} from './schema.js';

export function validateDate(month: number, day: number): void {
  // 2024 is a leap year, so 29 February is accepted.
  if (!DateTime.local(2024, month, day).isValid) {
    throw new UserError('That is not a valid date.');
  }
}

/**
 * The (month, day) pairs celebrated on a date. 29 February birthdays are
 * celebrated on 28 February in non-leap years.
 */
export function celebratedOn(
  date: DateTime,
): Array<{ month: number; day: number }> {
  const dates = [{ month: date.month, day: date.day }];
  if (date.month === 2 && date.day === 28 && !date.isInLeapYear) {
    dates.push({ month: 2, day: 29 });
  }
  return dates;
}

export async function setBirthday(
  db: Db,
  input: {
    guildId: string;
    userId: string;
    month: number;
    day: number;
    visibility: BirthdayVisibility;
  },
): Promise<void> {
  validateDate(input.month, input.day);
  await db
    .insert(birthdays)
    .values(input)
    .onConflictDoUpdate({
      target: [birthdays.guildId, birthdays.userId],
      set: { month: input.month, day: input.day, visibility: input.visibility },
    });
}

export async function removeBirthday(
  db: Db,
  guildId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .delete(birthdays)
    .where(and(eq(birthdays.guildId, guildId), eq(birthdays.userId, userId)))
    .returning({ userId: birthdays.userId });
  return rows.length > 0;
}

export async function getBirthday(
  db: Db,
  guildId: string,
  userId: string,
): Promise<Birthday | undefined> {
  const [row] = await db
    .select()
    .from(birthdays)
    .where(and(eq(birthdays.guildId, guildId), eq(birthdays.userId, userId)));
  return row;
}

/** Public birthdays ordered from `today` onward, wrapping around the year. */
export async function upcomingBirthdays(
  db: Db,
  guildId: string,
  today: DateTime,
  limit = 10,
): Promise<Birthday[]> {
  const rows = await db
    .select()
    .from(birthdays)
    .where(
      and(eq(birthdays.guildId, guildId), eq(birthdays.visibility, 'public')),
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
}

/**
 * Claims today's birthdays for announcement by stamping the year. Only rows
 * not yet stamped are returned, so a rerun on the same day announces nobody.
 */
export async function claimTodaysBirthdays(
  db: Db,
  guildId: string,
  today: DateTime,
): Promise<string[]> {
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
}

/** Undoes a claim when the announcement could not be posted, so a retry can. */
export async function releaseClaims(
  db: Db,
  guildId: string,
  userIds: string[],
  year: number,
): Promise<void> {
  if (userIds.length === 0) {
    return;
  }
  await db
    .update(birthdays)
    .set({ lastAnnouncedYear: sql`${year} - 1` })
    .where(
      and(
        eq(birthdays.guildId, guildId),
        inArray(birthdays.userId, userIds),
        eq(birthdays.lastAnnouncedYear, year),
      ),
    );
}

export async function getSettings(db: Db, guildId: string) {
  const [row] = await db
    .select()
    .from(birthdaySettings)
    .where(eq(birthdaySettings.guildId, guildId));
  return row;
}

export async function saveSettings(
  db: Db,
  settings: typeof birthdaySettings.$inferInsert,
): Promise<void> {
  await db
    .insert(birthdaySettings)
    .values(settings)
    .onConflictDoUpdate({ target: birthdaySettings.guildId, set: settings });
}

export async function deleteSettings(db: Db, guildId: string): Promise<void> {
  await db
    .delete(birthdaySettings)
    .where(eq(birthdaySettings.guildId, guildId));
}
