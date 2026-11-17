import type { Permission } from '~/core/permission';
import type { Poll } from '~/features/polls/model';
import type { Flash } from '~/web/context';
import { Layout } from '~/web/layout';
import { PollList } from './list';

interface Props {
  readonly open: Poll[];
  readonly date: (value: Date | null) => string;
  readonly can: ReadonlySet<Permission>;
  readonly flash: Flash;
  readonly canManage: (ownerId: string) => boolean;
}

export function PollPage({ open, date, can, flash, canManage }: Props) {
  return (
    <Layout
      can={can}
      title="Polls"
      path="/post/polls"
      flash={flash}
      actions={
        can.has('poll:create') ? <a href="/post/polls/new">New poll</a> : null
      }
    >
      <PollList open={open} date={date} canManage={canManage} />
    </Layout>
  );
}
