import type { Permission } from '~/core/permission';
import { Layout } from '~/web/layout';

interface Props {
  readonly title: string;
  readonly text: string;
  readonly can?: ReadonlySet<Permission>;
}

export function StatusPage({ title, text, can }: Props) {
  return (
    <Layout title={title} path="" {...(can && { can })}>
      <p>{text}</p>
      <p>
        <a href="/">Back to the overview</a>
      </p>
    </Layout>
  );
}
