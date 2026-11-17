import { startApp } from '~/app';
import { loadConfig } from '~/config';
import { createLogger, createLogStore } from '~/infra/logging';

let config: ReturnType<typeof loadConfig>;

try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const logs = createLogStore(config.LOG_DATABASE_PATH);
const log = createLogger(config.LOG_LEVEL, logs);

process.on('unhandledRejection', (reason) => {
  log.error({ err: reason }, 'Unhandled promise rejection');
});

try {
  const stop = await startApp(config, log, logs);
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) {
      return;
    }

    stopping = true;
    log.info({ signal }, 'Shutting down');
    stop().then(
      () => {
        logs.close();
        process.exit(0);
      },
      (error: unknown) => {
        log.error({ err: error }, 'Shutdown failed');
        logs.close();
        process.exit(1);
      },
    );
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  log.fatal({ err: error }, 'Startup failed');
  logs.close();
  process.exitCode = 1;
}
