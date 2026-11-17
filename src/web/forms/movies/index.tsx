import type { Permission } from '~/core/permission';
import type { MovieSuggestion } from '~/features/movies/model';
import type { Flash } from '~/web/context';
import { Layout } from '~/web/layout';
import { MovieCard } from './card';

interface Props {
  readonly list: MovieSuggestion[];
  readonly names: string[];
  readonly can: ReadonlySet<Permission>;
  readonly flash: Flash;
  readonly canManage: (ownerId: string) => boolean;
}

export function MoviePage({ list, names, can, flash, canManage }: Props) {
  return (
    <Layout
      can={can}
      title="Movies"
      path="/forms/movies"
      flash={flash}
      actions={<a href="/forms/movies/new">Suggest a movie</a>}
    >
      {list.length === 0 ? (
        <p>No suggestions yet. Be the first to suggest one.</p>
      ) : null}
      {list.map((movie, index) => (
        <MovieCard
          key={movie.id}
          movie={movie}
          suggestedBy={names[index] ?? ''}
          editable={canManage(movie.suggestedBy)}
        />
      ))}
    </Layout>
  );
}
