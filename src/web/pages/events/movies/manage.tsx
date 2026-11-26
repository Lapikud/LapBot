import type { MovieSuggestion } from '~/features/movies/model';
import { movieLabel } from '~/features/movies/rules';
import { Input, Select } from '~/web/components/controls';
import { ChannelSelect } from '~/web/components/selectors';
import type { Server } from '~/web/context';

export function MovieNightForms({
  list,
  server,
}: Readonly<{ list: MovieSuggestion[]; server: Server }>) {
  return (
    <>
      <h2>Start a vote</h2>
      <form method="post" action="/events/movies/vote">
        <div class="fields">
          <ChannelSelect server={server} />
          <Input
            label="Movies"
            name="count"
            type="number"
            min={2}
            max={10}
            value={5}
          />
          <Input label="Closes" name="closes" placeholder="Default: 2 days" />
        </div>
        <button type="submit">Start vote</button>
      </form>
      <h2>Plan a movie night</h2>
      <form method="post" action="/events/movies/night">
        <Select label="Movie" name="movieId">
          <option value="">Let people vote</option>
          {list.map((movie) => (
            <option key={movie.id} value={movie.id}>
              {movieLabel(movie)}
            </option>
          ))}
        </Select>
        <div class="fields">
          <Input
            label="Start"
            name="start"
            required
            placeholder="e.g. fri 19:00"
          />
          <Input label="Location" name="location" maxlength={200} />
          <Input label="Capacity" name="capacity" type="number" min={1} />
        </div>
        <Input
          label="Vote closes"
          name="closes"
          placeholder="Default: when the movie night starts"
        />
        <ChannelSelect server={server} />
        <button type="submit">Post movie night</button>
      </form>
    </>
  );
}

export function WatchedList({
  history,
  date,
}: Readonly<{
  history: ReadonlyArray<{
    title: string;
    year: number | null;
    watchedAt: Date | null;
  }>;
  date: (value: Date | null) => string;
}>) {
  return (
    <>
      <h2>Watched</h2>
      {history.length === 0 ? (
        <p>Nothing watched yet.</p>
      ) : (
        <div class="table-wrapper" tabIndex={0}>
          <table>
            <tbody>
              {history.map((movie) => (
                <tr key={`${movie.title}:${String(movie.watchedAt)}`}>
                  <td>{movieLabel(movie)}</td>
                  <td>{date(movie.watchedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
