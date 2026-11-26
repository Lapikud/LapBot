import type { Permission } from '~/core/permission';
import type { Flash, Server } from '~/web/context';
import { Layout } from '~/web/layout';
import { PollForm } from './form';

interface Props {
  server: Server;
  can: ReadonlySet<Permission>;
  flash: Flash;
}

export function NewPollPage({ server, can, flash }: Readonly<Props>) {
  return (
    <Layout can={can} title="New poll" path="/polls" flash={flash}>
      <PollForm server={server} />
    </Layout>
  );
}
