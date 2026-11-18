import type { Permission } from '~/core/permission';
import type { Flash, Server } from '~/web/context';
import { Layout } from '~/web/layout';
import { Composer } from './form';

interface Props {
  server: Server;
  can: ReadonlySet<Permission>;
  flash: Flash;
}

export function NewAnnouncementPage({ server, can, flash }: Readonly<Props>) {
  return (
    <Layout can={can} title="New PSA" path="/post/announcements" flash={flash}>
      <Composer server={server} can={can} />
    </Layout>
  );
}
