import { createEventSuggestionRepository } from './event-suggestions/repository';
import { PgBoss } from 'pg-boss';
import { createJobQueue, startJobs } from '~/integrations/scheduler/boss';
import { connectDatabase, runMigrations } from '~/integrations/db/client';
import { createAnnouncementRepository } from '~/integrations/db/announcements/repository';
import { createEventRepository } from '~/integrations/db/events/repository';
import { createBirthdayRepository } from '~/integrations/db/birthdays/repository';
import { createGrantRepository } from '~/integrations/db/permissions/repository';
import { createMovieRepository } from '~/integrations/db/movies/repository';
import { createPollRepository } from '~/integrations/db/polls/repository';
import { createReminderRepository } from '~/integrations/db/reminders/repository';
import { createRolePanelRepository } from '~/integrations/db/roles/repository';
import type { AppInfrastructure } from '~/infrastructure';
import type { Logger } from '~/core/ports/logger';
export function createPostgresInfrastructure(
  url: string,
  log: Logger,
): AppInfrastructure {
  const database = connectDatabase(url);
  const boss = new PgBoss({ connectionString: url });

  boss.on('error', (error) => log.error({ error }, 'Job queue error'));

  return {
    repositories: {
      announcements: createAnnouncementRepository(database.db),
      events: createEventRepository(database.db),
      eventSuggestions: createEventSuggestionRepository(database.db),
      birthdays: createBirthdayRepository(database.db),
      grants: createGrantRepository(database.db),
      movies: createMovieRepository(database.db),
      polls: createPollRepository(database.db),
      reminders: createReminderRepository(database.db),
      roles: createRolePanelRepository(database.db),
    },
    scheduler: createJobQueue(boss),
    migrate: () => runMigrations(database.db),
    start: async () => {
      await boss.start();
    },
    startJobs: (jobs, logger) => startJobs(boss, jobs, logger),
    stop: async () => {
      await boss.stop();
    },
    close: () => database.close(),
  };
}
