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
  icons: boolean;
  discordEventId: string | null;
  status: 'scheduled' | 'cancelled';
  createdAt: Date;
};

export type NewEvent = Omit<
  Event,
  'id' | 'messageId' | 'discordEventId' | 'status' | 'createdAt'
>;
