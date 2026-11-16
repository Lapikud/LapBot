import { randomUUID } from 'node:crypto';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { UserError } from '~/domain';
import { signedInUser, signInPages } from './auth';
import { birthdayPages } from './birthdays';
import { back, serverOf, type Env, type WebDeps } from './context';
import { eventPages } from './events';
import { Layout } from './layout';
import { permissionPages } from './permissions';
import { pollPages } from './polls';
import { psaPages } from './psa';

function Message({ title, text }: Readonly<{ title: string; text: string }>) {
  return (
    <Layout title={title} path="">
      <p>{text}</p>
      <p>
        <a href="/">Back to the overview</a>
      </p>
    </Layout>
  );
}

export function createWebApp(deps: WebDeps) {
  const { guildId, signIn, directory, services, log } = deps;
  const app = new Hono<Env>();

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        styleSrc: ["'self'", 'https://cdn.jsdelivr.net'],
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

    const [channels, roles] = await Promise.all([
      directory.channels(guildId),
      directory.roles(guildId),
    ]);

    c.set('actor', actor);
    c.set('server', serverOf(channels, roles));

    return next();
  });

  app.get('/', async (c) => {
    const [announcements, events, polls] = await Promise.all([
      services.announcements.list(guildId),
      services.events.upcoming(guildId),
      services.polls.open(guildId),
    ]);
    const pending = announcements.filter(
      (a) => a.status === 'scheduled' || a.status === 'draft',
    );

    return c.html(
      <Layout title="Overview" path="/">
        <ul>
          <li>
            <a href="/psa">{pending.length} PSA drafts and scheduled posts</a>
          </li>
          <li>
            <a href="/events">{events.length} upcoming events</a>
          </li>
          <li>
            <a href="/polls">{polls.length} open polls</a>
          </li>
        </ul>
      </Layout>,
    );
  });
  app.route('/psa', psaPages(deps));
  app.route('/events', eventPages(deps));
  app.route('/polls', pollPages(deps));
  app.route('/birthdays', birthdayPages(deps));
  app.route('/permissions', permissionPages(deps));

  app.notFound((c) =>
    c.html(<Message title="Not found" text="There is no such page." />, 404),
  );
  app.onError((error, c) => {
    if (error instanceof UserError && c.req.method === 'GET') {
      return c.html(<Message title="Not allowed" text={error.message} />, 403);
    }

    if (error instanceof UserError) {
      const section = `/${c.req.path.split('/')[1] ?? ''}`;

      return back(c, section, { error: error.message });
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
