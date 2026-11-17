import { Input, Textarea } from '~/web/components/controls';
import { ActionButton } from '~/web/components/actions';
import { Hono } from 'hono';
import type { MovieSuggestion } from '~/features/movies/model';
import { movieLabel, movieLinks } from '~/features/movies/rules';
import {
  back,
  field,
  flashOf,
  owns,
  type Env,
  type WebDeps,
} from '~/web/context';
import { Layout } from '~/web/layout';

const linksOf = (value: string | undefined) =>
  (value ?? '').split('\n').filter((line) => line.trim() !== '');

function MovieCard({
  movie,
  suggestedBy,
  editable,
}: Readonly<{
  movie: MovieSuggestion;
  suggestedBy: string;
  editable: boolean;
}>) {
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
        {editable ? (
          <>
            <form method="post" action={`/forms/movies/${movie.id}/links`}>
              <fieldset class="grid" aria-label="Add a movie link">
                <input
                  name="url"
                  type="url"
                  placeholder="Add a link"
                  aria-label="Link URL"
                  required
                />
                <button type="submit" class="secondary">
                  Add
                </button>
              </fieldset>
            </form>
            <ActionButton
              action={`/forms/movies/${movie.id}/remove`}
              label="Remove"
            />
          </>
        ) : null}
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
        <Layout
          can={c.var.can}
          title="Movies"
          path="/forms/movies"
          flash={flashOf(c)}
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
              editable={owns(c, movie.suggestedBy, 'movie:manage')}
            />
          ))}
        </Layout>,
      );
    })
    .get('/new', (c) =>
      c.html(
        <Layout
          can={c.var.can}
          title="Suggest a movie"
          path="/forms/movies"
          flash={flashOf(c)}
        >
          <form method="post" action="/forms/movies">
            <div class="grid">
              <Input label="Title" name="title" required maxlength={200} />
              <Input
                label="Year"
                name="year"
                type="number"
                min={1880}
                max={2100}
              />
            </div>
            <Input label="Why watch it?" name="note" maxlength={300} />
            <Textarea
              label="Links (one per line)"
              name="links"
              rows={2}
              placeholder="https://letterboxd.com/film/…"
            />
            <button type="submit">Suggest</button>
          </form>
        </Layout>,
      ),
    )
    .post('/', async (c) => {
      const form = await c.req.formData();
      const year = field(form, 'year');
      const movie = await services.movies.suggest(c.var.actor, {
        title: field(form, 'title') ?? '',
        year: year === undefined ? null : Number(year),
        note: field(form, 'note') ?? null,
        links: linksOf(field(form, 'links')),
      });

      return back(c, '/forms/movies', {
        notice: `Added ${movieLabel(movie)}.`,
      });
    })
    .post('/:id{\\d+}/links', async (c) => {
      const form = await c.req.formData();
      const movie = await services.movies.addLinks(
        c.var.actor,
        Number(c.req.param('id')),
        linksOf(field(form, 'url')),
      );

      return back(c, '/forms/movies', {
        notice: `Link added to ${movie.title}.`,
      });
    })
    .post('/:id{\\d+}/remove', async (c) => {
      const movie = await services.movies.remove(
        c.var.actor,
        Number(c.req.param('id')),
      );

      return back(c, '/forms/movies', { notice: `Removed ${movie.title}.` });
    });
}
