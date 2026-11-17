import type { Permission } from '~/core/permission';
import type { Flash, Server } from '~/web/context';
import { Layout } from '~/web/layout';
import { Composer } from './form';

interface Props {
  readonly server: Server;
  readonly can: ReadonlySet<Permission>;
  readonly flash: Flash;
}

export function NewAnnouncementPage({ server, can, flash }: Props) {
  return (
    <Layout can={can} title="New PSA" path="/post/announcements" flash={flash}>
      <Composer server={server} can={can} />
    </Layout>
  );
}
