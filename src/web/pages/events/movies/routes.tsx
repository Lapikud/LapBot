import { Hono } from 'hono';
import { movieLabel } from '~/features/movies/rules';
import {
  back,
  field,
  flashOf,
  formatter,
  owns,
  type Env,
  type WebDeps,
} from '~/web/context';
import { NewMoviePage } from './create';
import { MoviePage } from './index';

const linksOf = (value: string | undefined) =>
  (value ?? '').split('\n').filter((line) => line.trim() !== '');

export function movieRoutes({
  guildId,
  services,
  directory,
  timezone,
}: WebDeps) {
  const date = formatter(timezone);

  return new Hono<Env>()
    .get('/', async (c) => {
      const [list, history] = await Promise.all([
        services.movies.unwatched(guildId),
        services.movies.history(guildId),
      ]);
      const names = await Promise.all(
        list.map(
          async ({ suggestedBy }) =>
            (await directory.displayName(guildId, suggestedBy)) ??
            'a former member',
        ),
      );

      return c.html(
        <MoviePage
          list={list}
          names={names}
          history={history}
          server={await c.var.server()}
          date={date}
          can={c.var.can}
          flash={flashOf(c)}
          canManage={(ownerId) => owns(c, ownerId, 'movie:manage')}
        />,
      );
    })
    .get('/new', (c) =>
      c.html(<NewMoviePage can={c.var.can} flash={flashOf(c)} />),
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

      return back(c, '/events/movies', {
        notice: `Added ${movieLabel(movie)}.`,
      });
    })
    .post(String.raw`/:id{\d+}/links`, async (c) => {
      const form = await c.req.formData();
      const movie = await services.movies.addLinks(
        c.var.actor,
        Number(c.req.param('id')),
        linksOf(field(form, 'url')),
      );

      return back(c, '/events/movies', {
        notice: `Link added to ${movie.title}.`,
      });
    })
    .post('/vote', async (c) => {
      const form = await c.req.formData();
      const count = field(form, 'count');
      const closes = field(form, 'closes');
      const poll = await services.movies.vote(c.var.actor, {
        channelId: field(form, 'channelId') ?? '',
        ...(count !== undefined && { count: Number(count) }),
        ...(closes !== undefined && { closes }),
      });

      return back(c, '/events/movies', {
        notice: `Movie vote #${poll.id} started.`,
      });
    })
    .post('/night', async (c) => {
      const form = await c.req.formData();
      const movieId = field(form, 'movieId');
      const location = field(form, 'location');
      const capacity = field(form, 'capacity');
      const closes = field(form, 'closes');
      const { movie, event } = await services.movies.night(c.var.actor, {
        start: field(form, 'start') ?? '',
        channelId: field(form, 'channelId') ?? '',
        ...(movieId !== undefined && { movieId: Number(movieId) }),
        ...(location !== undefined && { location }),
        ...(capacity !== undefined && { capacity: Number(capacity) }),
        ...(closes !== undefined && { closes }),
      });

      return back(c, '/events/movies', {
        notice:
          movie === undefined
            ? `Movie night posted as event #${event.id}, with a vote on the movie.`
            : `Movie night for ${movieLabel(movie)} posted as event #${event.id}.`,
      });
    })
    .post(String.raw`/:id{\d+}/watched`, async (c) => {
      const movie = await services.movies.watched(
        c.var.actor,
        Number(c.req.param('id')),
      );

      return back(c, '/events/movies', {
        notice: `Marked ${movieLabel(movie)} as watched.`,
      });
    })
    .post(String.raw`/:id{\d+}/remove`, async (c) => {
      const movie = await services.movies.remove(
        c.var.actor,
        Number(c.req.param('id')),
      );

      return back(c, '/events/movies', { notice: `Removed ${movie.title}.` });
    });
}
