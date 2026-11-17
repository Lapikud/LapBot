import { serve } from '@hono/node-server';
import type { Logger } from '~/core/ports/logger';
import type { WebApp } from './app';

export async function startWebServer(
  app: WebApp,
  options: { port: number; host: string; log: Logger },
): Promise<() => Promise<void>> {
  const server = await new Promise<ReturnType<typeof serve>>(
    (resolve, reject) => {
      const started = serve(
        { fetch: app.fetch, port: options.port, hostname: options.host },
        () => {
          resolve(started);
        },
      );

      started.once('error', reject);
    },
  );

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
    });
}
