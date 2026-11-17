export interface CalendarEvent {
  title: string;
  description: string;
  location: string;
  startsAt: Date;
  endsAt: Date;
}

export interface Calendar {
  upsert: (
    guildId: string,
    id: string | null,
    event: CalendarEvent,
  ) => Promise<string>;
  remove: (guildId: string, id: string) => Promise<void>;
}
