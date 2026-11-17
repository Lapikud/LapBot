import { expect, it } from 'vitest';
import { eventCalendarEntry } from '~/core/calendar';

it('maps event calendar defaults without mutating feature data', () => {
  const event = {
    title: 'Night',
    description: null,
    location: null,
    startsAt: new Date('2026-11-20T16:00:00Z'),
    endsAt: null,
  };
  const before = structuredClone(event);

  expect(eventCalendarEntry(event)).toEqual({
    title: 'Night',
    description: '',
    location: 'See the event post',
    startsAt: new Date('2026-11-20T16:00:00Z'),
    endsAt: new Date('2026-11-20T18:00:00Z'),
  });
  expect(event).toEqual(before);
  expect(
    eventCalendarEntry({
      ...event,
      description: 'Games',
      location: 'Office',
      endsAt: new Date('2026-11-21T01:00:00Z'),
    }),
  ).toEqual({
    title: 'Night',
    description: 'Games',
    location: 'Office',
    startsAt: new Date('2026-11-20T16:00:00Z'),
    endsAt: new Date('2026-11-21T01:00:00Z'),
  });
});
