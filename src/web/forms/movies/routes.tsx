import { Hono } from 'hono';
import { movieLabel } from '~/features/movies/rules';
import {
  back,
  field,
  flashOf,
  owns,
  type Env,
  type WebDeps,
} from '~/web/context';
import { NewMoviePage } from './create';
import { MoviePage } from './index';

const linksOf = (value: string | undefined) =>
  (value ?? '').split('\n').filter((line) => line.trim() !== '');

export function movieRoutes({ guildId, services, directory }: WebDeps) {
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
        <MoviePage
          list={list}
          names={names}
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
