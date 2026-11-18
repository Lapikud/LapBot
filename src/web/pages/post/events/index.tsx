import type { Permission } from '~/core/permission';
import type { Event } from '~/features/events/model';
import type { Flash, Server } from '~/web/context';
import { Layout } from '~/web/layout';
import { EventList } from './list';

interface Props {
  upcoming: Event[];
  date: (value: Date | null) => string;
  server: Server;
  can: ReadonlySet<Permission>;
  flash: Flash;
  canManage: (ownerId: string) => boolean;
}

export function EventPage({
  upcoming,
  date,
  server,
  can,
  flash,
  canManage,
}: Readonly<Props>) {
  return (
    <Layout
      can={can}
      title="Events"
      path="/post/events"
      flash={flash}
      actions={
        can.has('event:create') ? (
          <a href="/post/events/new">New event</a>
        ) : null
      }
    >
      <EventList
        upcoming={upcoming}
        date={date}
        server={server}
        canManage={canManage}
      />
    </Layout>
  );
}
