import { en, ParsingComponents } from 'chrono-node';
import { TZDate, tz, tzOffset } from '@date-fns/tz';
import { addDays, addMonths, addWeeks, isValid, set } from 'date-fns';
import { UserError } from '~/core/errors';

const steps = { daily: addDays, weekly: addWeeks, monthly: addMonths };

export const recurrences = ['daily', 'weekly', 'monthly'] as const;

export type Recurrence = (typeof recurrences)[number];

export interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

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

export function parseWhen(input: string, zone: string, now = new Date()): Date {
  requireZone(zone);
  const text = input.trim();
  const result =
    text.length <= 100
      ? en.GB.parse(
          text,
          { instant: now, timezone: tzOffset(zone, now) },
          { forwardDate: true },
        )[0]
      : undefined;

  if (result?.text !== text) {
    throw new UserError(
      `I could not read "${input}". Try "30m", "2 hours", "18:30", "tomorrow at noon", "Friday at 6pm" or "20/11 18:00".`,
    );
  }

  const start = result.start;

  if (
    start instanceof ParsingComponents &&
    !start.isCertain('timezoneOffset')
  ) {
    start.assign('timezoneOffset', tzOffset(zone, result.date()));
  }

  const date = result.date();

  if (!isValid(date)) {
    throw new UserError('That is not a valid time.');
  }

  return new Date(date);
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
  return new Date(steps[recurrence](from, 1, { in: tz(zone) }));
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

  return new Date(next);
}

export function calendarDay(date: Date, zone: string): CalendarDay {
  const local = new TZDate(date, zone);

  return {
    year: local.getFullYear(),
    month: local.getMonth() + 1,
    day: local.getDate(),
  };
}

export function discordTime(
  date: Date,
  style: 'F' | 'R' | 'f' | 'D' | 't' = 'F',
): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}
