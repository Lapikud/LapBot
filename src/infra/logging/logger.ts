import { pino, type Logger } from 'pino';
import { recentLogs } from './buffer';

export type { Logger } from 'pino';

export function createLogger(level: string, logs = recentLogs): Logger {
  const pretty = process.stdout.isTTY && process.env.NODE_ENV !== 'production';

  return pino({
    level,
    hooks: { streamWrite: logs.write },
    redact: {
      paths: [
        'token',
        'apiKey',
        'api_key',
        'password',
        'headers',
        '*.token',
        '*.apiKey',
        '*.api_key',
        '*.password',
        '*.headers',
      ],
      censor: '[redacted]',
    },
    ...(pretty && { transport: { target: 'pino-pretty' } }),
  });
}
