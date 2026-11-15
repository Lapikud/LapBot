import { TZDate, tz } from '@date-fns/tz';
import { addDays, addMonths, addWeeks, isValid, parse, set } from 'date-fns';
import { UserError } from './errors';

const unitMs: Partial<Record<string, number>> = {
  w: 604_800_000,
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
};

const absoluteFormats = [
  'yyyy-MM-dd HH:mm',
  "yyyy-MM-dd'T'HH:mm",
  'd.M.yyyy H:mm',
  'yyyy-MM-dd',
  'd.M.yyyy',
];

const steps = { daily: addDays, weekly: addWeeks, monthly: addMonths };

export const recurrences = ['daily', 'weekly', 'monthly'] as const;

export type Recurrence = (typeof recurrences)[number];

export type CalendarDay = { year: number; month: number; day: number };

export function isZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });

    return true;
  } catch {
    return false;
  }
}

export function requireZone(zone: string): string {
  if (!isZone(zone)) {
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

  const total = compact
    .toLowerCase()
    .split(/(?<=[wdhm])/)
    .reduce(
      (sum, part) =>
        sum + Number(part.slice(0, -1)) * (unitMs[part.slice(-1)] ?? 0),
      0,
    );

  return new Date(now.getTime() + total);
}

function parseClock(input: string, zone: string, now: Date): Date | undefined {
  const clock = /^(\d{1,2}):(\d{2})$/.exec(input);

  if (!clock) {
    return undefined;
  }

  const hours = Number(clock[1]);
  const minutes = Number(clock[2]);

  if (hours > 23 || minutes > 59) {
    return undefined;
  }

  const today = set(
    now,
    { hours, minutes, seconds: 0, milliseconds: 0 },
    { in: tz(zone) },
  );

  return today <= now ? addDays(today, 1, { in: tz(zone) }) : today;
}

function parseAbsolute(
  input: string,
  zone: string,
  now: Date,
): Date | undefined {
  const trimmed = input.trim();

  return (
    parseClock(trimmed, zone, now) ??
    absoluteFormats
      .map((format) => parse(trimmed, format, now, { in: tz(zone) }))
      .find((date) => isValid(date))
  );
}

export function parseWhen(input: string, zone: string, now = new Date()): Date {
  const date =
    parseRelative(input, now) ?? parseAbsolute(input, requireZone(zone), now);

  if (date === undefined) {
    throw new UserError(
      `I could not read "${input}". Try "30m", "2h", "1d", "18:30" or "2026-11-20 18:00".`,
    );
  }

  return new Date(date.getTime());
}

export function parseFutureWhen(
  input: string,
  zone: string,
  now = new Date(),
): Date {
  const date = parseWhen(input, zone, now);

  if (date <= now) {
    throw new UserError('That time is in the past.');
  }

  return date;
}

export function nextOccurrence(
  from: Date,
  recurrence: Recurrence,
  zone: string,
): Date {
  return new Date(steps[recurrence](from, 1, { in: tz(zone) }).getTime());
}

export function nextFutureOccurrence(
  from: Date,
  recurrence: Recurrence,
  zone: string,
  now = new Date(),
): Date {
  let next = nextOccurrence(from, recurrence, zone);

  while (next <= now) {
    next = nextOccurrence(next, recurrence, zone);
  }

  return next;
}

export function nextDailyRun(
  zone: string,
  hour: number,
  now = new Date(),
): Date {
  const today = set(
    now,
    { hours: hour, minutes: 0, seconds: 0, milliseconds: 0 },
    { in: tz(zone) },
  );
  const next = today <= now ? addDays(today, 1, { in: tz(zone) }) : today;

  return new Date(next.getTime());
}

export function calendarDay(date: Date, zone: string): CalendarDay {
  const local = new TZDate(date, zone);

  return {
    year: local.getFullYear(),
    month: local.getMonth() + 1,
    day: local.getDate(),
  };
}

export function zonedTime(day: CalendarDay, hour: number, zone: string): Date {
  return new Date(
    new TZDate(day.year, day.month - 1, day.day, hour, 0, 0, zone).getTime(),
  );
}

export function discordTime(
  date: Date,
  style: 'F' | 'R' | 'f' | 'D' = 'F',
): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

export function addCalendarDays(day: CalendarDay, days: number): CalendarDay {
  const date = new Date(Date.UTC(day.year, day.month - 1, day.day + days));

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function formatCalendarDay(day: CalendarDay): string {
  return [day.year, day.month, day.day]
    .map((part) => String(part).padStart(2, '0'))
    .join('-');
}

export function parseCalendarDay(value: string): CalendarDay | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return undefined;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}
