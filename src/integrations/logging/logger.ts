import { pino, stdSerializers, type Logger } from 'pino';
import type { LogStore } from './store';

export function createLogger(
  level: string,
  logs: Pick<LogStore, 'write'>,
): Logger {
  const pretty = process.stdout.isTTY && process.env.NODE_ENV !== 'production';

  return pino({
    level,
    serializers: {
      error: stdSerializers.err,
      replyError: stdSerializers.err,
      reason: stdSerializers.err,
    },
    hooks: {
      streamWrite: (line) => {
        try {
          logs.write(line);
        } catch (error) {
          process.stderr.write(
            `Failed to save log entry: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }

        return line;
      },
    },
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
