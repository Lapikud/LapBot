import { Hono } from 'hono';
import type { MovieSuggestion } from '~/core/ports';
import { movieLabel, movieLinks } from '~/domain';
import { back, field, flashOf, type Env, type WebDeps } from './context';
import { ActionButton, Layout } from './layout';

const linksOf = (value: string | undefined) =>
  (value ?? '').split('\n').filter((line) => line.trim() !== '');

function MovieCard({
  movie,
  suggestedBy,
}: Readonly<{ movie: MovieSuggestion; suggestedBy: string }>) {
  return (
    <article class="movie">
      {movie.posterUrl === null ? (
        <div class="poster" />
      ) : (
        <img class="poster" src={movie.posterUrl} alt="" />
      )}
      <div>
        <h3>{movieLabel(movie)}</h3>
        <small>Suggested by {suggestedBy}</small>
        {movie.note === null ? null : <p>{movie.note}</p>}
        {movie.overview === null ? null : (
          <p class="overview">{movie.overview}</p>
        )}
        <p>
          {movieLinks(movie).map(({ label, url }) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              {label}
            </a>
          ))}
        </p>
        <form method="post" action={`/movies/${movie.id}/links`}>
          <div role="group">
            <input name="url" type="url" placeholder="Add a link" required />
            <button type="submit" class="secondary">
              Add
            </button>
          </div>
        </form>
        <ActionButton action={`/movies/${movie.id}/remove`} label="Remove" />
      </div>
    </article>
  );
}

export function moviePages({ guildId, services, directory }: WebDeps) {
  return new Hono<Env>()
    .get('/', async (c) => {
      const list = await services.movies.unwatched(guildId);
      const names = await Promise.all(
        list.map(
          async ({ suggestedBy }) =>
            (await directory.displayName(guildId, suggestedBy)) ??
            'a former member',
        ),
      );

      return c.html(
        <Layout title="Movies" path="/movies" flash={flashOf(c)}>
          {list.length === 0 ? <p>No suggestions yet.</p> : null}
          {list.map((movie, index) => (
            <MovieCard
              key={movie.id}
              movie={movie}
              suggestedBy={names[index] ?? ''}
            />
          ))}
          <h2>Suggest a movie</h2>
          <form method="post" action="/movies">
            <div class="grid">
              <label>
                Title
                <input name="title" required maxlength={200} />
              </label>
              <label>
                Year
                <input name="year" type="number" min={1880} max={2100} />
              </label>
            </div>
            <label>
              Why watch it?
              <input name="note" maxlength={300} />
            </label>
            <label>
              Links (one per line)
              <textarea
                name="links"
                rows={2}
                placeholder="https://letterboxd.com/film/…"
              />
            </label>
            <button type="submit">Suggest</button>
          </form>
        </Layout>,
      );
    })
    .post('/', async (c) => {
      const form = await c.req.formData();
      const year = field(form, 'year');
      const movie = await services.movies.suggest(c.var.actor, {
        title: field(form, 'title') ?? '',
        year: year === undefined ? null : Number(year),
        note: field(form, 'note') ?? null,
        links: linksOf(field(form, 'links')),
      });

      return back(c, '/movies', { notice: `Added ${movieLabel(movie)}.` });
    })
    .post('/:id{[0-9]+}/links', async (c) => {
      const form = await c.req.formData();
      const movie = await services.movies.addLinks(
        c.var.actor,
        Number(c.req.param('id')),
        linksOf(field(form, 'url')),
      );

      return back(c, '/movies', { notice: `Link added to ${movie.title}.` });
    })
    .post('/:id{[0-9]+}/remove', async (c) => {
      const movie = await services.movies.remove(
        c.var.actor,
        Number(c.req.param('id')),
      );

      return back(c, '/movies', { notice: `Removed ${movie.title}.` });
    });
}
