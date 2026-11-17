import { Hono } from 'hono';
import { UserError } from '~/core/errors';
import {
  back,
  field,
  flashOf,
  formatter,
  type Env,
  type WebDeps,
} from '~/web/context';
import { Layout } from '~/web/layout';

export function eventSuggestionRoutes({ services, timezone }: WebDeps) {
  return new Hono<Env>()
    .get('/', async (c) => {
      const page = Number(c.req.query('page') ?? 0);
      const list = await services.eventSuggestions.list(c.var.actor, page);

      return c.html(
        <Layout
          title="Event suggestions"
          path="/post/event-suggestions"
          can={c.var.can}
          flash={flashOf(c)}
        >
          {list.length === 0 && <p>No suggestions on this page.</p>}
          {list.map((idea) => (
            <article key={idea.id}>
              <h2>Suggestion #{idea.id}</h2>
              <p>{idea.text}</p>
              <p>
                By {idea.authorId} · {formatter(timezone)(idea.createdAt)} ·{' '}
                {idea.status}
              </p>
              {idea.messageId !== null && (
                <p>
                  <a
                    href={`https://discord.com/channels/${idea.guildId}/${idea.channelId}/${idea.messageId}`}
                  >
                    View message
                  </a>
                </p>
              )}
              <form method="post" action={`/post/event-suggestions/${idea.id}`}>
                <select name="status">
                  <option value="reviewed">Mark reviewed</option>
                  <option value="dismissed">Dismiss</option>
                  <option value="new">Reopen</option>
                </select>
                <button type="submit">Save</button>
              </form>
            </article>
          ))}
          {page > 0 && <a href={`?page=${page - 1}`}>Previous</a>}
          {list.length === 25 && <a href={`?page=${page + 1}`}>Next</a>}
        </Layout>,
      );
    })
    .post(String.raw`/:id{\d+}`, async (c) => {
      const status = field(await c.req.formData(), 'status');

      if (status !== 'new' && status !== 'reviewed' && status !== 'dismissed') {
        throw new UserError('Invalid status.');
      }

      await services.eventSuggestions.review(
        c.var.actor,
        Number(c.req.param('id')),
        status,
      );

      return back(c, '/post/event-suggestions', {
        notice: 'Suggestion updated.',
      });
    });
}
