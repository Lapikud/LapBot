import type { Permission } from '~/core/permission';
import type { Flash } from '~/web/context';
import { Layout } from '~/web/layout';
import { MovieForm } from './form';

interface Props {
  readonly can: ReadonlySet<Permission>;
  readonly flash: Flash;
}

export function NewMoviePage({ can, flash }: Props) {
  return (
    <Layout
      can={can}
      title="Suggest a movie"
      path="/forms/movies"
      flash={flash}
    >
      <MovieForm />
    </Layout>
  );
}
