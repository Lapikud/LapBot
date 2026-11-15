import { startApp } from '~/app';
import { loadConfig } from '~/config';
import { createLogger } from '~/infra/logging';

let config: ReturnType<typeof loadConfig>;

try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const log = createLogger(config.LOG_LEVEL);

process.on('unhandledRejection', (reason) => {
  log.error({ err: reason }, 'Unhandled promise rejection');
});

try {
  const stop = await startApp(config, log);
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) {
      return;
    }

    stopping = true;
    log.info({ signal }, 'Shutting down');
    stop().then(
      () => process.exit(0),
      (error: unknown) => {
        log.error({ err: error }, 'Shutdown failed');
        process.exit(1);
      },
    );
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  log.fatal({ err: error }, 'Startup failed');
  process.exitCode = 1;
}
