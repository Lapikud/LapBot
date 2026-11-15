import { and, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { isLeapYear } from 'date-fns';
import type { CalendarDay } from '~/shared/time';
import type { Db } from '~/db/client';
import { UserError } from '~/shared/errors';
import {
  birthdays,
  birthdaySettings,
  type Birthday,
  type BirthdayVisibility,
} from './schema';

export function validateDate(month: number, day: number): void {
  const date = new Date(2024, month - 1, day);

  if (date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new UserError('That is not a valid date.');
  }
}

export function celebratedOn(
  date: CalendarDay,
): Array<{ month: number; day: number }> {
  const dates = [{ month: date.month, day: date.day }];

  if (
    date.month === 2 &&
    date.day === 28 &&
    !isLeapYear(new Date(date.year, 0, 1))
  ) {
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

export async function upcomingBirthdays(
  db: Db,
  guildId: string,
  today: CalendarDay,
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

export async function claimTodaysBirthdays(
  db: Db,
  guildId: string,
  today: CalendarDay,
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
