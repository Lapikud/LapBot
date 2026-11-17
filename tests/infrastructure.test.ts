import { expect, it, vi } from 'vitest';
import { compose } from '~/app';
import { loadConfig } from '~/config/env';
import type { AppInfrastructure } from '~/infrastructure';
import { silentLog } from './fakes';

vi.mock('~/integrations/db/infrastructure', () => ({
  createPostgresInfrastructure: () => {
    throw new Error('Composition must not open the production database');
  },
}));

it('composes all features with an injected infrastructure without using storage', async () => {
  const storageAccess = vi.fn(() => {
    throw new Error('Composition must not query storage');
  });
  const repository = new Proxy({}, { get: () => storageAccess });
  const infrastructure = {
    repositories: {
      announcements: repository,
      events: repository,
      eventSuggestions: repository,
      birthdays: repository,
      grants: repository,
      movies: repository,
      polls: repository,
      reminders: repository,
      roles: repository,
    },
    scheduler: { schedule: vi.fn(), cancel: vi.fn() },
    migrate: vi.fn(),
    start: vi.fn(),
    startJobs: vi.fn(),
    stop: vi.fn(),
    close: vi.fn(),
  } as unknown as AppInfrastructure;
  const config = loadConfig({
    DISCORD_TOKEN: 'test',
    DATABASE_URL: 'postgres://unused.invalid/unused',
  });
  const app = compose(config, silentLog, infrastructure);

  expect(app.infrastructure).toBe(infrastructure);
  expect(app.registry.features.map((feature) => feature.name)).toContain(
    'events',
  );
  expect(app.jobs.size).toBeGreaterThan(0);
  expect(storageAccess).not.toHaveBeenCalled();
  expect(infrastructure.start).not.toHaveBeenCalled();
  await app.client.destroy();
});
