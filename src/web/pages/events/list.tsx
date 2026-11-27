import type { Event } from '~/features/events/model';
import { ActionButton } from '~/web/components/actions';
import type { Server } from '~/web/context';

interface Props {
  upcoming: Event[];
  date: (value: Date | null) => string;
  server: Server;
  canManage: (ownerId: string) => boolean;
}
export function EventList({
  upcoming,
  date,
  server,
  canManage,
}: Readonly<Props>) {
  return (
    <div class="table-wrapper" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Title</th>
            <th>Starts</th>
            <th>Channel</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {upcoming.map((e) => (
            <tr key={e.id}>
              <td>{e.id}</td>
              <td>
                <a href={`/events/${e.id}`}>{e.title}</a>
              </td>
              <td>{date(e.startsAt)}</td>
              <td>{server.channelName(e.channelId)}</td>
              <td>
                {canManage(e.organizerId) ? (
                  <>
                    <ActionButton
                      action={`/events/${e.id}/cancel`}
                      label="Cancel"
                      subject={e.title}
                      confirm="Cancel this event? Members who RSVPed will see it as cancelled."
                    />
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
