import type { Permission } from '~/core/permission';
import {
  rsvpStatuses,
  type Event,
  type RsvpStatus,
} from '~/features/events/model';
import { rsvpLabels } from '~/features/events/message';
import { Checkbox } from '~/web/components/choices';
import type { Flash, Server } from '~/web/context';
import { Layout } from '~/web/layout';
import { EventFields } from './fields';

interface Props {
  event: Event;
  attendees: ReadonlyArray<{ name: string; status: RsvpStatus }>;
  manageable: boolean;
  server: Server;
  date: (value: Date | null) => string;
  time: (value: Date | null) => string;
  can: ReadonlySet<Permission>;
  flash: Flash;
}

export function EventDetailPage({
  event,
  attendees,
  manageable,
  server,
  date,
  time,
  can,
  flash,
}: Readonly<Props>) {
  return (
    <Layout can={can} title={event.title} path="/events" flash={flash}>
      <p>
        {date(event.startsAt)}
        {event.endsAt === null ? null : ` – ${date(event.endsAt)}`} ·{' '}
        {server.channelName(event.channelId)}
        {event.location === null ? null : ` · ${event.location}`}
      </p>
      {event.description === null ? null : <p>{event.description}</p>}
      <form method="post" action={`/events/${event.id}/rsvp`} class="grid">
        {rsvpStatuses.map((status) => (
          <button
            key={status}
            type="submit"
            name="status"
            value={status}
            class={status === 'going' ? undefined : 'secondary'}
          >
            {rsvpLabels[status]}
          </button>
        ))}
      </form>
      {rsvpStatuses.map((status) => {
        const names = attendees
          .filter((attendee) => attendee.status === status)
          .map(({ name }) => name);

        return (
          <p key={status}>
            <strong>
              {rsvpLabels[status]} ({names.length}
              {status === 'going' && event.capacity !== null
                ? `/${event.capacity}`
                : ''}
              )
            </strong>
            {names.length === 0 ? null : `: ${names.join(', ')}`}
          </p>
        );
      })}
      {manageable ? (
        <>
          <h2>Edit</h2>
          <form method="post" action={`/events/${event.id}`}>
            <EventFields event={event} time={time} />
            <fieldset>
              <Checkbox
                name="icons"
                label="Show 🗓️ 🕐 📍 icons"
                checked={event.icons}
              />
            </fieldset>
            <button type="submit">Save changes</button>
          </form>
          {can.has('event:calendar:publish') && (
            <form method="post" action={`/events/${event.id}/calendar`}>
              <button type="submit" class="secondary">
                {event.calendarEventId === null
                  ? 'Also add to calendar'
                  : 'Retry calendar sync'}
              </button>
            </form>
          )}
        </>
      ) : null}
    </Layout>
  );
}
