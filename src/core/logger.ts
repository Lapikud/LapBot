import { pino, type Logger } from 'pino';

export type { Logger } from 'pino';

export function createLogger(level: string): Logger {
  const pretty = process.stdout.isTTY && process.env.NODE_ENV !== 'production';

  return pino({
    level,
    redact: {
      paths: ['*.token', '*.apiKey', '*.api_key', '*.password', 'headers'],
      censor: '[redacted]',
    },
    ...(pretty && { transport: { target: 'pino-pretty' } }),
  });
}
