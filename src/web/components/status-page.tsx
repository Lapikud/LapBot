import type { Permission } from '~/core/permission';
import { Layout } from '~/web/layout';

interface Props {
  title: string;
  text: string;
  can?: ReadonlySet<Permission>;
}

export function StatusPage({ title, text, can }: Readonly<Props>) {
  return (
    <Layout title={title} path="" {...(can && { can })}>
      <p>{text}</p>
      <p>
        <a href="/">Back to the overview</a>
      </p>
    </Layout>
  );
}
