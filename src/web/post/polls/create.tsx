import type { Permission } from '~/core/permission';
import type { Flash, Server } from '~/web/context';
import { Layout } from '~/web/layout';
import { PollForm } from './form';

interface Props {
  readonly server: Server;
  readonly can: ReadonlySet<Permission>;
  readonly flash: Flash;
}

export function NewPollPage({ server, can, flash }: Props) {
  return (
    <Layout can={can} title="New poll" path="/post/polls" flash={flash}>
      <PollForm server={server} />
    </Layout>
  );
}
