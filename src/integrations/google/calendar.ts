import { auth, calendar } from '@googleapis/calendar';
import type { Calendar, CalendarEvent } from '~/core/ports/calendar';

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const body = (event: CalendarEvent) => ({
  summary: event.title,
  description: event.description,
  location: event.location,
  start: { dateTime: event.startsAt.toISOString() },
  end: { dateTime: event.endsAt.toISOString() },
});

export function createGoogleCalendar(
  calendarId: string,
  credentials: ServiceAccount,
): Calendar {
  const api = calendar({
    version: 'v3',
    auth: new auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
    }),
  });

  return {
    upsert: async (id, event) => {
      if (id !== null) {
        await api.events.patch({
          calendarId,
          eventId: id,
          requestBody: body(event),
        });

        return id;
      }

      const { data } = await api.events.insert({
        calendarId,
        requestBody: body(event),
      });

      if (data.id === null || data.id === undefined) {
        throw new Error('Google Calendar returned no event ID');
      }

      return data.id;
    },
    remove: async (id) => {
      await api.events.delete(
        { calendarId, eventId: id },
        {
          validateStatus: (status) =>
            (status >= 200 && status < 300) || status === 410,
        },
      );
    },
    between: async (from, to) => {
      const { data } = await api.events.list({
        calendarId,
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50,
      });

      return (data.items ?? []).flatMap((item) => {
        const dateTime = item.start?.dateTime ?? undefined;
        const start = dateTime ?? item.start?.date ?? undefined;

        if (item.id === null || item.id === undefined || start === undefined) {
          return [];
        }

        return [
          {
            id: item.id,
            title: item.summary ?? 'Untitled',
            startsAt: new Date(start),
            allDay: dateTime === undefined,
          },
        ];
      });
    },
  };
}
