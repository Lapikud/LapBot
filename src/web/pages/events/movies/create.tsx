import type { Permission } from '~/core/permission';
import type { Flash } from '~/web/context';
import { Layout } from '~/web/layout';
import { MovieForm } from './form';

interface Props {
  can: ReadonlySet<Permission>;
  flash: Flash;
}

export function NewMoviePage({ can, flash }: Readonly<Props>) {
  return (
    <Layout
      can={can}
      title="Suggest a movie"
      path="/events/movies"
      flash={flash}
    >
      <MovieForm />
    </Layout>
  );
}
