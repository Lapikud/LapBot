import type { FormRepository } from '~/features/forms/model';
import type { EventSuggestionRepository } from '~/features/event-suggestions/model';
import type { Job, Scheduler } from '~/core/ports/scheduler';
import type { Logger } from '~/core/ports/logger';
import type { AnnouncementRepository } from '~/features/announcements/model';
import type { EventRepository } from '~/features/events/model';
import type { BirthdayRepository } from '~/features/birthdays/model';
import type { GrantRepository } from '~/features/permissions/model';
import type { MovieRepository } from '~/features/movies/model';
import type { PollRepository } from '~/features/polls/model';
import type { ReminderRepository } from '~/features/reminders/model';
import type { RolePanelRepository } from '~/features/roles/model';

export interface AppInfrastructure {
  repositories: {
    announcements: AnnouncementRepository;
    events: EventRepository;
    eventSuggestions: EventSuggestionRepository;
    forms: FormRepository;
    birthdays: BirthdayRepository;
    grants: GrantRepository;
    movies: MovieRepository;
    polls: PollRepository;
    reminders: ReminderRepository;
    roles: RolePanelRepository;
  };
  scheduler: Scheduler;
  migrate: () => Promise<void>;
  start: () => Promise<void>;
  startJobs: (jobs: Iterable<Job<unknown>>, log: Logger) => Promise<void>;
  stop: () => Promise<void>;
  close: () => Promise<void>;
}
