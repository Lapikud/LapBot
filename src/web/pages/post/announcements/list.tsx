import type { Announcement } from '~/features/announcements/model';
import { ActionButton } from '~/web/components/actions';
import { type Server } from '~/web/context';

export function Recent({
  list,
  server,
  date,
}: Readonly<{
  list: Announcement[];
  server: Server;
  date: (value: Date | null) => string;
}>) {
  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Status</th>
          <th>Channel</th>
          <th>Title</th>
          <th>When</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {list.map((a) => (
          <tr key={a.id}>
            <td>{a.id}</td>
            <td>
              {a.status}
              {a.failure === null ? null : (
                <>
                  <br />
                  <small>{a.failure}</small>
                </>
              )}
            </td>
            <td>{server.channelName(a.channelId)}</td>
            <td>
              {a.status === 'cancelled' ? (
                (a.title ?? a.content.slice(0, 60))
              ) : (
                <a href={`/post/announcements/${a.id}`}>
                  {a.title ?? a.content.slice(0, 60)}
                </a>
              )}
            </td>
            <td>{date(a.publishedAt ?? a.scheduledAt)}</td>
            <td>
              {a.status === 'draft' || a.status === 'scheduled' ? (
                <>
                  <ActionButton
                    action={`/post/announcements/${a.id}/publish`}
                    label="Publish"
                  />
                  <ActionButton
                    action={`/post/announcements/${a.id}/cancel`}
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
