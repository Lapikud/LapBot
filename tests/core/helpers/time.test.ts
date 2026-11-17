import { describe, expect, it } from 'vitest';
import { UserError } from '~/core/errors';
import {
  nextFutureOccurrence,
  nextOccurrence,
  parseFutureWhen,
  parseWhen,
} from '~/core/helpers/time';

const zone = 'Europe/Tallinn';
const now = new Date('2026-03-10T10:00:00Z');

describe('parseWhen', () => {
  it.each([
    ['10m', 10 * 60_000],
    ['2h30m', 150 * 60_000],
    ['in 1d 2h', 26 * 3_600_000],
    ['1w', 7 * 86_400_000],
  ])('reads relative "%s"', (input, offset) => {
    expect(parseWhen(input, zone, now).getTime()).toBe(now.getTime() + offset);
  });

  it('reads absolute times in the given zone', () => {
    expect(parseWhen('2026-11-20 18:00', zone, now).toISOString()).toBe(
      '2026-11-20T16:00:00.000Z',
    );
    expect(parseWhen('20.11.2026 18:00', zone, now).toISOString()).toBe(
      '2026-11-20T16:00:00.000Z',
    );
    expect(parseWhen('2026-07-01 18:00', 'UTC', now).toISOString()).toBe(
      '2026-07-01T18:00:00.000Z',
    );
  });

  it('reads a bare clock time as its next occurrence', () => {
    expect(parseWhen('18:30', zone, now).toISOString()).toBe(
      '2026-03-10T16:30:00.000Z',
    );
    expect(parseWhen('09:00', zone, now).toISOString()).toBe(
      '2026-03-11T07:00:00.000Z',
    );
  });

  it('reads days by name and day.month without a year', () => {
    const at = (input: string) => parseWhen(input, zone, now).toISOString();

    expect(at('tomorrow 9:00')).toBe('2026-03-11T07:00:00.000Z');
    expect(at('today 18:00')).toBe('2026-03-10T16:00:00.000Z');
    expect(at('fri 18:00')).toBe('2026-03-13T16:00:00.000Z');
    expect(at('Tuesday 11:00')).toBe('2026-03-17T09:00:00.000Z');
    expect(at('20.11 18:00')).toBe('2026-11-20T16:00:00.000Z');
    expect(at('1.2 10:00')).toBe('2027-02-01T08:00:00.000Z');
  });

  it('reads an end time relative to the start', () => {
    const start = new Date('2026-11-20T16:00:00Z');

    expect(parseWhen('21:00', zone, start).toISOString()).toBe(
      '2026-11-20T19:00:00.000Z',
    );
    expect(parseWhen('3h', zone, start).toISOString()).toBe(
      '2026-11-20T19:00:00.000Z',
    );
  });

  const clockFormats = [
    '%s',
    'today %s',
    'tomorrow %s',
    'tue %s',
    'Friday %s',
    '20.11 %s',
    '20.11.2026 %s',
    '2026-11-20 %s',
    '2026-11-20T%s',
  ];

  it.each(clockFormats)('rejects out-of-range clocks in "%s"', (format) => {
    for (const clock of ['24:00', '23:60', '99:99', '9:99']) {
      expect(() => parseWhen(format.replace('%s', clock), zone, now)).toThrow(
        UserError,
      );
    }
  });

  it.each(clockFormats)('accepts clock boundaries in "%s"', (format) => {
    for (const clock of ['00:00', '9:00', '23:59']) {
      const date = parseWhen(format.replace('%s', clock), 'UTC', now);
      const [hours, minutes] = clock.split(':').map(Number);

      expect(date.getUTCHours()).toBe(hours);
      expect(date.getUTCMinutes()).toBe(minutes);
      expect(date.getUTCSeconds()).toBe(0);
      expect(date.getUTCMilliseconds()).toBe(0);
    }
  });

  it('rejects nonsense, invalid zones and past times', () => {
    expect(() => parseWhen('next tuesday-ish', zone, now)).toThrow(UserError);
    expect(() => parseWhen('2026-01-01 10:00', 'Mars/Base', now)).toThrow(
      'Unknown timezone',
    );
    expect(() => parseFutureWhen('2020-01-01 10:00', zone, now)).toThrow(
      'in the past',
    );
  });
});

describe('recurrence', () => {
  it('keeps the wall-clock time across a DST change', () => {
    const before = new Date('2026-03-28T07:00:00Z');

    expect(nextOccurrence(before, 'daily', zone).toISOString()).toBe(
      '2026-03-29T06:00:00.000Z',
    );
  });

  it('skips occurrences missed while offline', () => {
    const old = new Date('2026-03-01T10:00:00Z');

    expect(nextFutureOccurrence(old, 'weekly', 'UTC', now).toISOString()).toBe(
      '2026-03-15T10:00:00.000Z',
    );
  });

  it('clamps monthly recurrences to shorter months', () => {
    expect(
      nextOccurrence(
        new Date('2026-01-31T10:00:00Z'),
        'monthly',
        'UTC',
      ).toISOString(),
    ).toBe('2026-02-28T10:00:00.000Z');
  });
});
