export const rsvpStatuses = ['going', 'maybe', 'not_going'] as const;

export type RsvpStatus = (typeof rsvpStatuses)[number];

export type RsvpCounts = Record<RsvpStatus, number>;

export type Event = {
  id: number;
  guildId: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  timezone: string;
  location: string | null;
  organizerId: string;
  channelId: string;
  messageId: string | null;
  capacity: number | null;
  mentionRoleId: string | null;
  reminderMinutes: number[];
  discordEventId: string | null;
  status: 'scheduled' | 'cancelled';
  createdAt: Date;
};

export type NewEvent = Omit<
  Event,
  'id' | 'messageId' | 'discordEventId' | 'status' | 'createdAt'
>;

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
