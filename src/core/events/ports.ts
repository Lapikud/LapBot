import type { RsvpStatus, RsvpCounts, Event, NewEvent } from '~/domain/events';
export type EventRepository = {
  insert: (event: NewEvent) => Promise<Event>;
  find: (id: number) => Promise<Event | undefined>;
  upcoming: (guildId: string, limit?: number) => Promise<Event[]>;
  update: (
    id: number,
    changes: Partial<Omit<Event, 'id' | 'guildId'>>,
  ) => Promise<Event>;
  setRsvp: (
    eventId: number,
    userId: string,
    status: RsvpStatus,
  ) => Promise<void>;
  counts: (eventId: number) => Promise<RsvpCounts>;
  attendees: (
    eventId: number,
  ) => Promise<Array<{ userId: string; status: RsvpStatus }>>;
};
