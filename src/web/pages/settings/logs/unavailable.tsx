import type { Permission } from '~/core/permission';
import { Layout } from '~/web/layout';

interface Props {
  can: ReadonlySet<Permission>;
}

export function LogsUnavailablePage({ can }: Readonly<Props>) {
  return (
    <Layout can={can} title="Logs" path="/settings/logs">
      <p>Only server administrators can view logs.</p>
    </Layout>
  );
}
