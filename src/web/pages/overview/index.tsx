import type { Permission } from '~/core/permission';
import { Layout } from '~/web/layout';

interface Props {
  readonly can: ReadonlySet<Permission>;
  readonly pendingCount: number;
  readonly eventCount: number;
  readonly pollCount: number;
}
export function OverviewPage({
  can,
  pendingCount,
  eventCount,
  pollCount,
}: Props) {
  return (
    <Layout can={can} title="Overview" path="/">
      <ul>
        {can.has('announcement:create') ? (
          <li>
            <a href="/post/announcements">
              {pendingCount} PSA drafts and scheduled posts
            </a>
          </li>
        ) : null}
        <li>
          <a href="/post/events">{eventCount} upcoming events</a>
        </li>
        <li>
          <a href="/post/polls">{pollCount} open polls</a>
        </li>
      </ul>
    </Layout>
  );
}
