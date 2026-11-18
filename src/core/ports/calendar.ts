export interface CalendarEvent {
  title: string;
  description: string;
  location: string;
  startsAt: Date;
  endsAt: Date;
}

export interface CalendarEntry {
  id: string;
  title: string;
  startsAt: Date;
  allDay: boolean;
}

export interface Calendar {
  upsert: (id: string | null, event: CalendarEvent) => Promise<string>;
  remove: (id: string) => Promise<void>;
  between: (from: Date, to: Date) => Promise<CalendarEntry[]>;
}
