import { describe, expect, it } from 'vitest';
import { UserError } from './errors.js';
import {
  nextFutureOccurrence,
  nextOccurrence,
  parseFutureWhen,
  parseWhen,
} from './time.js';

const zone = 'Europe/Tallinn';
const now = new Date('2026-03-10T10:00:00Z'); // 12:00 in Tallinn

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
    // Tallinn moves to summer time on 2026-03-29.
    const before = new Date('2026-03-28T07:00:00Z'); // 09:00 EET
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
