import type { Event } from '~/features/events/model';
import { ActionButton } from '~/web/components/actions';
import type { Server } from '~/web/context';

interface Props {
  readonly upcoming: Event[];
  readonly date: (value: Date | null) => string;
  readonly server: Server;
  readonly canManage: (ownerId: string) => boolean;
}
export function EventList({ upcoming, date, server, canManage }: Props) {
  return (
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
            <td>{e.title}</td>
            <td>{date(e.startsAt)}</td>
            <td>{server.channelName(e.channelId)}</td>
            <td>
              {canManage(e.organizerId) ? (
                <>
                  <a href={`/post/events/${e.id}`} class="secondary outline">
                    Edit
                  </a>{' '}
                  <ActionButton
                    action={`/post/events/${e.id}/cancel`}
                    label="Cancel"
                  />
                </>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
