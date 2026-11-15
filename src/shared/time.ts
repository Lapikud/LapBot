import { DateTime, IANAZone } from 'luxon';
import { UserError } from './errors.js';

const unitMs: Partial<Record<string, number>> = {
  w: 604_800_000,
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
};
const absoluteFormats = [
  'yyyy-MM-dd HH:mm',
  "yyyy-MM-dd'T'HH:mm",
  'd.M.yyyy HH:mm',
  'd.M.yyyy H:mm',
  'yyyy-MM-dd',
  'd.M.yyyy',
];

export const recurrences = ['daily', 'weekly', 'monthly'] as const;
export type Recurrence = (typeof recurrences)[number];

export function requireZone(zone: string): string {
  if (!IANAZone.isValidZone(zone)) {
    throw new UserError(
      `Unknown timezone "${zone}". Use an IANA name like Europe/Tallinn.`,
    );
  }
  return zone;
}

function parseRelative(input: string, now: Date): Date | undefined {
  const compact = input
    .trim()
    .replace(/^in\s+/i, '')
    .replaceAll(/\s+/g, '');
  if (!/^(?:\d+[wdhm])+$/i.test(compact)) {
    return undefined;
  }
  let total = 0;
  for (const part of compact.toLowerCase().split(/(?<=[wdhm])/)) {
    total += Number(part.slice(0, -1)) * (unitMs[part.slice(-1)] ?? 0);
  }
  return new Date(now.getTime() + total);
}

function parseAbsolute(
  input: string,
  zone: string,
  now: Date,
): Date | undefined {
  const trimmed = input.trim();
  const clock = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (clock) {
    // A bare time means its next occurrence.
    const today = DateTime.fromJSDate(now, { zone }).set({
      hour: Number(clock[1]),
      minute: Number(clock[2]),
      second: 0,
      millisecond: 0,
    });
    if (!today.isValid) {
      return undefined;
    }
    return (
      today.toMillis() <= now.getTime() ? today.plus({ days: 1 }) : today
    ).toJSDate();
  }
  for (const format of absoluteFormats) {
    const parsed = DateTime.fromFormat(trimmed, format, { zone });
    if (parsed.isValid) {
      return parsed.toJSDate();
    }
  }
  return undefined;
}

/**
 * Parses "10m", "2h30m", "1w 2d", "18:30", "2026-11-20 18:00" or
 * "20.11.2026 18:00". Absolute times are read in the given IANA zone.
 */
export function parseWhen(input: string, zone: string, now = new Date()): Date {
  const date =
    parseRelative(input, now) ?? parseAbsolute(input, requireZone(zone), now);
  if (date === undefined) {
    throw new UserError(
      `I could not read "${input}". Try "30m", "2h", "1d", "18:30" or "2026-11-20 18:00".`,
    );
  }
  return date;
}

export function parseFutureWhen(
  input: string,
  zone: string,
  now = new Date(),
): Date {
  const date = parseWhen(input, zone, now);
  if (date.getTime() <= now.getTime()) {
    throw new UserError('That time is in the past.');
  }
  return date;
}

/** Advances by wall-clock time in the zone, so recurrences survive DST. */
export function nextOccurrence(
  from: Date,
  recurrence: Recurrence,
  zone: string,
): Date {
  const step = {
    daily: { days: 1 },
    weekly: { weeks: 1 },
    monthly: { months: 1 },
  }[recurrence];
  return DateTime.fromJSDate(from, { zone }).plus(step).toJSDate();
}

/** First occurrence strictly after `now`, skipping any missed while offline. */
export function nextFutureOccurrence(
  from: Date,
  recurrence: Recurrence,
  zone: string,
  now = new Date(),
): Date {
  let next = nextOccurrence(from, recurrence, zone);
  while (next.getTime() <= now.getTime()) {
    next = nextOccurrence(next, recurrence, zone);
  }
  return next;
}

/** Discord renders these in each reader's own timezone. */
export function discordTime(
  date: Date,
  style: 'F' | 'R' | 'f' | 'D' = 'F',
): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

/** The next time the clock in `zone` reads `hour`:00, strictly after now. */
export function nextDailyRun(
  zone: string,
  hour: number,
  now = DateTime.now(),
): Date {
  const today = now
    .setZone(zone)
    .set({ hour, minute: 0, second: 0, millisecond: 0 });
  return (today <= now ? today.plus({ days: 1 }) : today).toJSDate();
}
