import { holdsAny, movieRunners, type Permission } from '~/core/permission';
import type { MovieSuggestion, WatchedMovie } from '~/features/movies/model';
import { MovieNightForms, WatchedList } from './manage';
import type { Flash, Server } from '~/web/context';
import { Layout } from '~/web/layout';
import { MovieCard } from './card';

interface Props {
  list: MovieSuggestion[];
  names: string[];
  history: WatchedMovie[];
  server: Server;
  date: (value: Date | null) => string;
  can: ReadonlySet<Permission>;
  flash: Flash;
  canManage: (ownerId: string) => boolean;
}

export function MoviePage({
  list,
  names,
  history,
  server,
  date,
  can,
  flash,
  canManage,
}: Readonly<Props>) {
  return (
    <Layout
      can={can}
      title="Movies"
      path="/events/movies"
      flash={flash}
      actions={<a href="/events/movies/new">Suggest a movie</a>}
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
          manager={holdsAny(can, movieRunners)}
        />
      ))}
      {holdsAny(can, movieRunners) ? (
        <MovieNightForms list={list} server={server} />
      ) : null}
      <WatchedList history={history} date={date} />
    </Layout>
  );
}
