import { z } from 'zod';

export const logCapacity = 500;

export type LogEntry = {
  time: number;
  level: number;
  message: string;
  source: string;
  details: string;
};

const record = z
  .object({
    time: z.number(),
    level: z.number(),
    msg: z.string().default(''),
  })
  .catchall(z.unknown());

export function createLogBuffer() {
  // ponytail: process-local recent history; use stdout storage for durable logs.
  const entries: LogEntry[] = [];

  return {
    write: (line: string): string => {
      try {
        const parsed = record.safeParse(JSON.parse(line));

        if (parsed.success) {
          const { time, level, msg, ...details } = parsed.data;
          const source =
            details.service ?? details.component ?? details.feature;

          entries.push({
            time,
            level,
            message: msg.slice(0, 2048),
            source: typeof source === 'string' ? source.slice(0, 256) : 'app',
            details: JSON.stringify(details, null, 2).slice(0, 8192),
          });
          if (entries.length > logCapacity) {
            entries.shift();
          }
        }
      } catch {
        // A viewer must never prevent the original log from reaching stdout.
      }

      return line;
    },
    entries: (): readonly LogEntry[] => entries.toReversed(),
  };
}

export const recentLogs = createLogBuffer();
