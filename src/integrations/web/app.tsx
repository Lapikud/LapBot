import { visibleRecords } from '~/core/helpers/visibility';
import { randomUUID } from 'node:crypto';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { UserError } from '~/core/errors';
import { webAccess, type Permission } from '~/core/permission';
import { signedInUser, signInPages } from './auth';
import { birthdayPages } from '~/features/birthdays/web';
import { back, serverOf, type Env, type WebDeps } from './context';
import { eventPages } from '~/features/events/web';
import { moviePages } from '~/features/movies/web';
import { logPages } from './logs';
import { Layout } from './layout';
import { permissionPages } from '~/features/permissions/web';
import { rolePages } from '~/features/roles/web';
import { pollPages } from '~/features/polls/web';
import { psaPages } from '~/features/announcements/web';

function Message({
  title,
  text,
  can,
}: Readonly<{ title: string; text: string; can?: ReadonlySet<Permission> }>) {
  return (
    <Layout title={title} path="" {...(can && { can })}>
      <p>{text}</p>
      <p>
        <a href="/">Back to the overview</a>
      </p>
    </Layout>
  );
}

function returnPath(referer: string | undefined, path: string): string {
  const section = `/${path.split('/')[1] ?? ''}`;
  const from = referer === undefined ? null : URL.parse(referer);

  if (from?.pathname.startsWith(section) !== true) {
    return section;
  }

  from.searchParams.delete('notice');
  from.searchParams.delete('error');

  return `${from.pathname}${from.search}`;
}

export function createWebApp(deps: WebDeps) {
  const { guildId, signIn, directory, authz, services, log } = deps;
  const app = new Hono<Env>();

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        styleSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'https://image.tmdb.org'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: 'same-origin',
    }),
  );
  app.use(serveStatic({ root: 'public' }));
  app.use(
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) =>
        c.html(
          <Message title="Too large" text="That form is too large." />,
          413,
        ),
    }),
  );
  app.use(csrf());
  app.route('/', signInPages(signIn));
  app.use(async (c, next) => {
    const userId = await signedInUser(c, signIn);

    if (userId === undefined) {
      return c.redirect('/login', 303);
    }

    const actor = await directory.member(guildId, userId);

    if (!actor) {
      return c.html(
        <Message
          title="Not a member"
          text="Your Discord account is not a member of the server."
        />,
        403,
      );
    }

    if (!(await authz.can(actor, webAccess))) {
      return c.html(
        <Message
          title="No access yet"
          text="Ask a server administrator to give one of your roles access to the dashboard."
        />,
        403,
      );
    }

    const [channels, roles] = await Promise.all([
      directory.channels(guildId),
      directory.roles(guildId),
    ]);

    const held = await Promise.all(
      services.permissions
        .catalogue()
        .map(async ({ id }) => ((await authz.can(actor, id)) ? [id] : [])),
    );

    c.set('actor', actor);
    c.set('can', new Set(held.flat()));
    const visible = await visibleRecords(
      directory,
      actor,
      channels.map((channel) => ({ ...channel, channelId: channel.id })),
    );

    c.set('server', serverOf(visible, roles));

    return next();
  });

  app.get('/', async (c) => {
    const [announcements, events, polls] = await Promise.all([
      services.announcements.list(c.var.actor),
      services.events.upcoming(guildId),
      services.polls.open(guildId),
    ]);
    const [visibleEvents, visiblePolls] = await Promise.all([
      visibleRecords(directory, c.var.actor, events),
      visibleRecords(directory, c.var.actor, polls),
    ]);
    const pending = announcements.filter(
      (a) => a.status === 'scheduled' || a.status === 'draft',
    );

    return c.html(
      <Layout can={c.var.can} title="Overview" path="/">
        <ul>
          {c.var.can.has('announcement:create') ? (
            <li>
              <a href="/psa">{pending.length} PSA drafts and scheduled posts</a>
            </li>
          ) : null}
          <li>
            <a href="/events">{visibleEvents.length} upcoming events</a>
          </li>
          <li>
            <a href="/polls">{visiblePolls.length} open polls</a>
          </li>
        </ul>
      </Layout>,
    );
  });
  app.route('/psa', psaPages(deps));
  app.route('/events', eventPages(deps));
  app.route('/polls', pollPages(deps));
  app.route('/birthdays', birthdayPages(deps));
  app.route('/movies', moviePages(deps));
  app.route('/roles', rolePages(deps));
  app.route('/permissions', permissionPages(deps));
  app.route('/logs', logPages(deps.timezone, deps.logs));

  app.notFound((c) =>
    c.html(<Message title="Not found" text="There is no such page." />, 404),
  );
  app.onError((error, c) => {
    if (error instanceof UserError && c.req.method === 'GET') {
      return c.html(
        <Message title="Not allowed" text={error.message} can={c.var.can} />,
        403,
      );
    }

    if (error instanceof UserError) {
      return back(c, returnPath(c.req.header('referer'), c.req.path), {
        error: error.message,
      });
    }

    if (error instanceof HTTPException && c.req.path === '/login') {
      return c.html(
        <Message
          title="Sign-in failed"
          text="Discord did not confirm the sign-in. Open the page again to retry."
        />,
        error.status,
      );
    }

    if (error instanceof HTTPException && error.status === 403) {
      return c.html(
        <Message
          title="Forbidden"
          text="This form came from another site. Reload the page and try again."
        />,
        403,
      );
    }

    const ref = randomUUID().slice(0, 8);

    log.error({ err: error, ref, path: c.req.path }, 'Web request failed');

    return c.html(
      <Message title="Something went wrong" text={`Reference: ${ref}`} />,
      500,
    );
  });

  return app;
}

export type WebApp = ReturnType<typeof createWebApp>;
