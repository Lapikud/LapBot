import { Hono, type Context } from 'hono';
import { UserError } from '~/core/errors';
import type { Announcement } from '~/features/announcements/model';
import {
  allows,
  back,
  field,
  flashOf,
  formatter,
  type Env,
  type WebDeps,
} from '~/web/context';
import { ComposerPage } from './create';
import { AnnouncementPage } from './index';
import { draftOf, type Draft } from './submission';

const draftFrom = (post: Announcement): Draft => ({
  when: '',
  channelId: post.channelId,
  title: post.title ?? '',
  content: post.content,
  mentions: post.mentions,
});

export function announcementRoutes({ services, timezone }: WebDeps) {
  const date = formatter(timezone);
  const { announcements } = services;

  const submit = async (
    c: Context<Env>,
    page: { title: string; action: string; published?: boolean },
    save: (draft: Draft) => Promise<Announcement>,
  ) => {
    const form = await c.req.formData();
    const action = form.get('action');
    const draft = draftOf(form);
    const { actor } = c.var;

    if (action === 'preview') {
      return c.html(
        <ComposerPage
          {...page}
          server={await c.var.server()}
          can={c.var.can}
          draft={draft}
          view={announcements.view({
            ...draft,
            title: draft.title === '' ? null : draft.title,
            authorId: actor.userId,
          })}
        />,
      );
    }

    const saved = await save(draft);

    if (action === 'publish') {
      await announcements.publish(actor, saved.id);

      return back(c, '/post/announcements', {
        notice: `PSA #${saved.id} published.`,
      });
    }

    if (action === 'schedule') {
      const scheduled = await announcements.schedule(
        actor,
        saved.id,
        field(form, 'when') ?? '',
      );

      return back(c, '/post/announcements', {
        notice: `PSA #${saved.id} scheduled for ${date(scheduled.scheduledAt)}.`,
      });
    }

    return back(c, '/post/announcements', {
      notice: `PSA #${saved.id} saved.`,
    });
  };

  return new Hono<Env>()
    .use(async (c, next) => {
      if (!allows(c, 'announcement:post')) {
        throw new UserError('You need the "announcement:post" permission.');
      }

      await next();
    })
    .get('/', async (c) => {
      const list = await announcements.list(c.var.actor);

      return c.html(
        <AnnouncementPage
          list={list}
          server={await c.var.server()}
          date={date}
          can={c.var.can}
          flash={flashOf(c)}
        />,
      );
    })
    .get('/new', async (c) =>
      c.html(
        <ComposerPage
          title="New PSA"
          action="/post/announcements"
          server={await c.var.server()}
          can={c.var.can}
          flash={flashOf(c)}
        />,
      ),
    )
    .post('/', (c) =>
      submit(c, { title: 'New PSA', action: '/post/announcements' }, (draft) =>
        announcements.draft(c.var.actor, draft),
      ),
    )
    .get(String.raw`/:id{\d+}`, async (c) => {
      const post = await announcements.get(
        c.var.actor,
        Number(c.req.param('id')),
      );

      return c.html(
        <ComposerPage
          title={`Edit PSA #${post.id}`}
          action={`/post/announcements/${post.id}`}
          published={post.status === 'published'}
          server={await c.var.server()}
          can={c.var.can}
          flash={flashOf(c)}
          draft={draftFrom(post)}
        />,
      );
    })
    .post(String.raw`/:id{\d+}`, async (c) => {
      const id = Number(c.req.param('id'));
      const post = await announcements.get(c.var.actor, id);
      const published = post.status === 'published';

      return submit(
        c,
        {
          title: `Edit PSA #${id}`,
          action: `/post/announcements/${id}`,
          published,
        },
        (draft) =>
          announcements.edit(c.var.actor, id, {
            title: draft.title,
            content: draft.content,
            ...(!published && {
              channelId: draft.channelId,
              mentions: draft.mentions,
            }),
          }),
      );
    })
    .post(String.raw`/:id{\d+}/publish`, async (c) => {
      const id = Number(c.req.param('id'));

      await announcements.publish(c.var.actor, id);

      return back(c, '/post/announcements', {
        notice: `PSA #${id} published.`,
      });
    })
    .post(String.raw`/:id{\d+}/cancel`, async (c) => {
      const id = Number(c.req.param('id'));

      await announcements.cancel(c.var.actor, id);

      return back(c, '/post/announcements', {
        notice: `PSA #${id} cancelled.`,
      });
    });
}
