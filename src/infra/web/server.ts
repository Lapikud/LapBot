import { createServer } from 'node:http';
import type { Logger } from '~/core/ports';
import type { WebApp } from './app';

export async function startWebServer(
  app: WebApp,
  options: { port: number; host: string; log: Logger },
): Promise<() => Promise<void>> {
  const server = createServer((request, response) => {
    app.handle(request, response).catch((error: unknown) => {
      options.log.error({ err: error }, 'Web handler crashed');
      response.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, resolve);
  });
  options.log.info(
    { host: options.host, port: options.port },
    'Web UI listening',
  );

  return () =>
    new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
      server.closeAllConnections();
    });
}
