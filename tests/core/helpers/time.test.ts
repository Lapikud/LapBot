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
    ['2 mins', 120_000],
    ['2 hrs', 7_200_000],
    ['2 hours 30 minutes', 9_000_000],
    ['in 1.5 hours', 5_400_000],
    ['30 seconds', 30_000],
  ])('reads relative "%s"', (input, offset) => {
    expect(parseWhen(input, zone, now).getTime()).toBe(now.getTime() + offset);
  });

  it.each([
    ['tomorrow at noon', '2026-03-11T10:00:00.000Z'],
    ['Friday at 6pm', '2026-03-13T16:00:00.000Z'],
    ['next Friday at 6pm', '2026-03-20T16:00:00.000Z'],
    ['tomorrow 9:00', '2026-03-11T07:00:00.000Z'],
    ['today 18:00', '2026-03-10T16:00:00.000Z'],
    ['Tuesday 11:00', '2026-03-17T09:00:00.000Z'],
    ['18:30', '2026-03-10T16:30:00.000Z'],
    ['09:00', '2026-03-11T07:00:00.000Z'],
    ['20/11 18:00', '2026-11-20T16:00:00.000Z'],
    ['1/2 10:00', '2027-02-01T08:00:00.000Z'],
    ['20.11.2026 18:00', '2026-11-20T16:00:00.000Z'],
    ['2026-11-20 18:00', '2026-11-20T16:00:00.000Z'],
    ['2026-07-01 18:00', '2026-07-01T15:00:00.000Z'],
    ['2026-07-01T18:00:00+03:00', '2026-07-01T15:00:00.000Z'],
    ['1 month', '2026-04-10T09:00:00.000Z'],
  ])('reads calendar input "%s" in the server timezone', (input, expected) => {
    expect(parseWhen(input, zone, now).toISOString()).toBe(expected);
  });

  it('preserves elapsed durations and wall-clock appointments across DST', () => {
    const before = new Date('2026-03-28T20:00:00Z');

    expect(parseWhen('tomorrow 9:00', zone, before).toISOString()).toBe(
      '2026-03-29T06:00:00.000Z',
    );
    expect(parseWhen('8 hours', zone, before).toISOString()).toBe(
      '2026-03-29T04:00:00.000Z',
    );
  });

  it('reads end times relative to their start', () => {
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
    '20/11 %s',
    '20.11.2026 %s',
    '2026-11-20 %s',
    '2026-11-20T%s',
  ];

  it.each(clockFormats)('rejects invalid clocks in "%s"', (format) => {
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

  it.each([
    'next tuesday-ish',
    'today 23:60',
    '20.11 18:00',
    '1 hour garbage',
    '0 minutes '.repeat(11),
  ])('rejects incomplete or oversized input "%s"', (input) => {
    expect(() => parseWhen(input, zone, now)).toThrow(UserError);
  });

  it('rejects invalid zones and nonfuture scheduling', () => {
    expect(() => parseWhen('tomorrow 9:00', 'Mars/Base', now)).toThrow(
      'Unknown timezone',
    );
    for (const input of ['2020-01-01 10:00', '-1 hour', '0m']) {
      expect(() => parseFutureWhen(input, zone, now)).toThrow('in the past');
    }
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
