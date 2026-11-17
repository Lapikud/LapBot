import type { Permission } from '~/core/permission';
import type { Announcement } from '~/features/announcements/model';
import type { Flash, Server } from '~/web/context';
import { Layout } from '~/web/layout';
import { Recent } from './list';

const title = 'Announcements';

interface Props {
  list: Announcement[];
  server: Server;
  date: (value: Date | null) => string;
  can: ReadonlySet<Permission>;
  userId: string;
  flash: Flash;
}

export function AnnouncementPage({
  list,
  server,
  date,
  can,
  userId,
  flash,
}: Readonly<Props>) {
  return (
    <Layout
      can={can}
      title={title}
      path="/post/announcements"
      flash={flash}
      actions={<a href="/post/announcements/new">New PSA</a>}
    >
      <Recent
        list={list}
        server={server}
        date={date}
        can={can}
        userId={userId}
      />
    </Layout>
  );
}
