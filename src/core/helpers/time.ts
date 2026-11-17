import parseDuration from 'parse-duration';
import { TZDate, tz } from '@date-fns/tz';
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  isValid,
  parse,
  set,
} from 'date-fns';
import { UserError } from '~/core/errors';

const absoluteFormats = [
  'yyyy-MM-dd HH:mm',
  "yyyy-MM-dd'T'HH:mm",
  'd.M.yyyy H:mm',
  'yyyy-MM-dd',
  'd.M.yyyy',
];

const dayMonthFormats = ['d.M H:mm', 'd.M'];

const weekdays = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
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
  if (input.length > 100) {
    return undefined;
  }

  const text = input
    .trim()
    .replace(/^in\s+/i, '')
    .replaceAll(/\band\b|,/gi, ' ')
    .trim();
  const parts = text.split(/(?<=\p{L})\s*(?=[\d.])/u);

  let total = 0;

  for (const part of parts) {
    // Consume the whole segment: the library also accepts noisy partial input.
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)\s*\p{L}+$/u.test(part)) {
      return undefined;
    }

    const duration = parseDuration(part);

    if (duration === null || !Number.isFinite(duration)) {
      return undefined;
    }

    total += duration;
  }

  const date = new Date(now.getTime() + total);

  return isValid(date) ? date : undefined;
}

function parseClockFields(
  input: string,
): { hours: number; minutes: number } | undefined {
  if (!/^\d{1,2}:\d{2}$/.test(input)) {
    return undefined;
  }

  const clock = parse(input, 'H:mm', new Date(0), { in: tz('UTC') });

  if (!isValid(clock)) {
    return undefined;
  }

  return { hours: clock.getHours(), minutes: clock.getMinutes() };
}

function parseClock(input: string, zone: string, now: Date): Date | undefined {
  const clock = parseClockFields(input);

  if (!clock) {
    return undefined;
  }

  const today = set(
    now,
    { ...clock, seconds: 0, milliseconds: 0 },
    { in: tz(zone) },
  );

  return today <= now ? addDays(today, 1, { in: tz(zone) }) : today;
}

function dayOffset(name: string, now: Date, zone: string): number | undefined {
  if (name === 'today') {
    return 0;
  }

  if (name === 'tomorrow') {
    return 1;
  }

  const index = weekdays.findIndex(
    (day) => name.length >= 3 && day.startsWith(name),
  );

  return index === -1
    ? undefined
    : (index - new TZDate(now, zone).getDay() + 7) % 7;
}

function parseNamedDay(
  input: string,
  zone: string,
  now: Date,
): Date | undefined {
  const match = /^([a-z]+)\s+(\d{1,2}:\d{2})$/i.exec(input);
  const offset = match && dayOffset(match[1]?.toLowerCase() ?? '', now, zone);
  const clock = parseClockFields(match?.[2] ?? '');

  if (!match || !clock || offset === undefined || offset === null) {
    return undefined;
  }

  const date = set(
    addDays(now, offset, { in: tz(zone) }),
    {
      ...clock,
      seconds: 0,
      milliseconds: 0,
    },
    { in: tz(zone) },
  );
  const weekday = match[1]?.toLowerCase() !== 'today';

  return weekday && offset === 0 && date <= now
    ? addDays(date, 7, { in: tz(zone) })
    : date;
}

function parseDayMonth(
  input: string,
  zone: string,
  now: Date,
): Date | undefined {
  const date = dayMonthFormats
    .map((format) => parse(input, format, now, { in: tz(zone) }))
    .find((candidate) => isValid(candidate));

  if (date === undefined) {
    return undefined;
  }

  return date < now ? addYears(date, 1, { in: tz(zone) }) : date;
}

function parseAbsolute(
  input: string,
  zone: string,
  now: Date,
): Date | undefined {
  const trimmed = input.trim();

  return (
    parseClock(trimmed, zone, now) ??
    parseNamedDay(trimmed, zone, now) ??
    parseDayMonth(trimmed, zone, now) ??
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
      `I could not read "${input}". Try "30m", "2h", "18:30", "tomorrow 9:00", "fri 18:00" or "20.11 18:00".`,
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

export function sameCalendarDay(a: Date, b: Date, zone: string): boolean {
  return (
    formatCalendarDay(calendarDay(a, zone)) ===
    formatCalendarDay(calendarDay(b, zone))
  );
}

export function zonedTime(day: CalendarDay, hour: number, zone: string): Date {
  return new Date(
    new TZDate(day.year, day.month - 1, day.day, hour, 0, 0, zone).getTime(),
  );
}

export function discordTime(
  date: Date,
  style: 'F' | 'R' | 'f' | 'D' | 't' = 'F',
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
