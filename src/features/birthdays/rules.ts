import { isLeapYear } from 'date-fns';
import { UserError } from '~/foundation/errors';
import type { CalendarDay } from '~/foundation/time';

export const birthdayVisibilities = ['public', 'announce', 'private'] as const;

export type BirthdayVisibility = (typeof birthdayVisibilities)[number];

export const birthdayVisibilityLabels: Record<BirthdayVisibility, string> = {
  public: 'Announce it and show it in upcoming birthdays',
  announce: 'Announce it, but keep the date unlisted',
  private: 'Keep it private: no announcement',
};

export function validateBirthday(month: number, day: number): void {
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
