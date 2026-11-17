import type { Permission } from '~/core/permission';
import type { Announcement } from '~/features/announcements/model';
import { ActionButton } from '~/web/components/actions';
import { type Server } from '~/web/context';

export function Recent({
  list,
  server,
  date,
  can,
  userId,
}: Readonly<{
  list: Announcement[];
  server: Server;
  date: (value: Date | null) => string;
  can: ReadonlySet<Permission>;
  userId: string;
}>) {
  const publisher = can.has('announcement:publish');

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
            <td>{a.title ?? a.content.slice(0, 60)}</td>
            <td>{date(a.publishedAt ?? a.scheduledAt)}</td>
            <td>
              {a.status === 'draft' || a.status === 'scheduled' ? (
                <>
                  {publisher ? (
                    <ActionButton
                      action={`/post/announcements/${a.id}/publish`}
                      label="Publish"
                    />
                  ) : null}
                  {publisher || a.authorId === userId ? (
                    <ActionButton
                      action={`/post/announcements/${a.id}/cancel`}
                      label="Cancel"
                    />
                  ) : null}
                </>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
