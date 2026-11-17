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
