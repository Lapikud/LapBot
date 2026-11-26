import type { Permission } from '~/core/permission';
import type { Poll } from '~/features/polls/model';
import type { Flash } from '~/web/context';
import { Layout } from '~/web/layout';
import { PollList } from './list';

interface Props {
  open: Poll[];
  date: (value: Date | null) => string;
  can: ReadonlySet<Permission>;
  flash: Flash;
  canManage: (ownerId: string) => boolean;
}

export function PollPage({
  open,
  date,
  can,
  flash,
  canManage,
}: Readonly<Props>) {
  return (
    <Layout
      can={can}
      title="Polls"
      path="/polls"
      flash={flash}
      actions={
        can.has('poll:create') ? <a href="/polls/new">New poll</a> : null
      }
    >
      <PollList open={open} date={date} canManage={canManage} />
    </Layout>
  );
}
