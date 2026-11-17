import type { CalendarEvent, Event } from '~/core/ports';

type EventDetails = Pick<
  Event,
  'title' | 'description' | 'location' | 'startsAt' | 'endsAt'
>;

export function eventCalendarEntry(event: EventDetails): CalendarEvent {
  return {
    title: event.title,
    description: event.description ?? '',
    location: event.location ?? 'See the event post',
    startsAt: event.startsAt,
    endsAt:
      event.endsAt ?? new Date(event.startsAt.getTime() + 2 * 60 * 60 * 1000),
  };
}
