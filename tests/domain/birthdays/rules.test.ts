import { describe, expect, it } from 'vitest';
import { celebratedOn, validateBirthday } from '~/domain/birthdays';
import { nextDailyRun } from '~/domain';

describe('birthday dates', () => {
  it('accepts 29 February and rejects impossible dates', () => {
    expect(() => validateBirthday(2, 29)).not.toThrow();
    expect(() => validateBirthday(2, 30)).toThrow('valid date');
    expect(() => validateBirthday(4, 31)).toThrow('valid date');
  });

  it('celebrates leap-day birthdays on 28 February in non-leap years', () => {
    expect(celebratedOn({ year: 2027, month: 2, day: 28 })).toEqual([
      { month: 2, day: 28 },
      { month: 2, day: 29 },
    ]);
    expect(celebratedOn({ year: 2028, month: 2, day: 28 })).toEqual([
      { month: 2, day: 28 },
    ]);
  });

  it('computes the next announcement hour in the guild timezone', () => {
    const now = new Date('2026-06-01T10:00:00Z');

    expect(nextDailyRun('Europe/Tallinn', 9, now).toISOString()).toBe(
      '2026-06-02T06:00:00.000Z',
    );
    expect(nextDailyRun('Europe/Tallinn', 15, now).toISOString()).toBe(
      '2026-06-01T12:00:00.000Z',
    );
  });
});
