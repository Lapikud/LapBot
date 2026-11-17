import { Hono } from 'hono';
import { UserError } from '~/core/errors';
import {
  allows,
  back,
  field,
  flashOf,
  formatter,
  type Env,
  type WebDeps,
} from '~/web/context';
import { NewAnnouncementPage } from './create';
import { AnnouncementPage } from './index';
import { AnnouncementPreviewPage } from './preview';
import { draftOf } from './submission';

export function announcementRoutes({ guildId, services, timezone }: WebDeps) {
  const date = formatter(timezone);

  return new Hono<Env>()
    .use(async (c, next) => {
      if (!allows(c, 'announcement:create')) {
        throw new UserError('You need the "announcement:create" permission.');
      }

      await next();
    })
    .get('/', async (c) => {
      const list = await services.announcements.list(c.var.actor);

      return c.html(
        <AnnouncementPage
          list={list}
          server={c.var.server}
          date={date}
          can={c.var.can}
          userId={c.var.actor.userId}
          flash={flashOf(c)}
        />,
      );
    })
    .get('/new', (c) =>
      c.html(
        <NewAnnouncementPage
          server={c.var.server}
          can={c.var.can}
          flash={flashOf(c)}
        />,
      ),
    )
    .post('/', async (c) => {
      const form = await c.req.formData();
      const action = form.get('action');
      const draft = draftOf(form);
      const { actor } = c.var;

      if (action === 'preview') {
        const view = services.announcements.view({
          ...draft,
          title: draft.title === '' ? null : draft.title,
          id: 0,
          guildId,
          authorId: actor.userId,
          status: 'draft',
          scheduledAt: null,
          publishedAt: null,
          messageId: null,
          failure: null,
          createdAt: new Date(),
        });

        return c.html(
          <AnnouncementPreviewPage
            server={c.var.server}
            can={c.var.can}
            draft={draft}
            view={view}
          />,
        );
      }

      const created = await services.announcements.draft(actor, draft);

      if (action === 'publish') {
        await services.announcements.publish(actor, created.id);

        return back(c, '/post/announcements', {
          notice: `PSA #${created.id} published.`,
        });
      }

      if (action === 'schedule') {
        const scheduled = await services.announcements.schedule(
          actor,
          created.id,
          field(form, 'when') ?? '',
        );

        return back(c, '/post/announcements', {
          notice: `PSA #${created.id} scheduled for ${date(scheduled.scheduledAt)}.`,
        });
      }

      return back(c, '/post/announcements', {
        notice: `Draft #${created.id} saved.`,
      });
    })
    .post(String.raw`/:id{\d+}/publish`, async (c) => {
      const id = Number(c.req.param('id'));

      await services.announcements.publish(c.var.actor, id);

      return back(c, '/post/announcements', {
        notice: `PSA #${id} published.`,
      });
    })
    .post(String.raw`/:id{\d+}/cancel`, async (c) => {
      const id = Number(c.req.param('id'));

      await services.announcements.cancel(c.var.actor, id);

      return back(c, '/post/announcements', {
        notice: `PSA #${id} cancelled.`,
      });
    });
}
