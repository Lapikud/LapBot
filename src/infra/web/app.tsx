import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { UserError } from '~/domain';
import { back, type Env, type WebDeps } from './context';
import { eventPages } from './events';
import { Layout } from './layout';
import { permissionPages } from './permissions';
import { pollPages } from './polls';
import { psaPages } from './psa';

const style = `${readFileSync(
  createRequire(import.meta.url).resolve(
    '@picocss/pico/css/pico.classless.min.css',
  ),
  'utf8',
)}
td form { display: inline-block; margin: 0 .25rem 0 0; }
td button { padding: .25rem .75rem; margin: 0; }
.notice { padding: .5rem .75rem; border-radius: 6px; background: #dafbe1; color: #1a7f37; }
.error { padding: .5rem .75rem; border-radius: 6px; background: #ffebe9; color: #cf222e; }
.discord { background: #313338; color: #dbdee1; padding: .75rem 1rem; border-radius: 8px; margin-bottom: 1rem; }
.discord .h1 { font-size: 1.5rem; font-weight: 700; }
.mention { background: #3c4270; color: #c9cdfb; border-radius: 3px; padding: 0 .15rem; }
`;

function Message(props: Readonly<{ title: string; text: string }>) {
  return (
    <Layout title={props.title} path="">
      <p>{props.text}</p>
      <p>
        <a href="/">Back to the overview</a>
      </p>
    </Layout>
  );
}

export function createWebApp(deps: WebDeps) {
  const { guildId, auth, directory, services, log } = deps;
  const app = new Hono<Env>();

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        styleSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: 'same-origin',
    }),
  );
  app.get('/style.css', (c) =>
    c.body(style, 200, { 'Content-Type': 'text/css; charset=utf-8' }),
  );
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
  app.use(async (c, next) => {
    const actor = await auth.authenticate({
      headers: Object.fromEntries(c.req.raw.headers),
    });

    if (!actor) {
      return c.html(
        <Message title="Sign in required" text="Sign-in is not set up." />,
        401,
      );
    }

    const [channels, roles] = await Promise.all([
      directory.channels(guildId),
      directory.roles(guildId),
    ]);
    const roleNames = new Map(roles.map((role) => [role.id, role.name]));
    const channelNames = new Map(
      channels.map((channel) => [channel.id, channel.name]),
    );

    c.set('actor', actor);
    c.set('guild', {
      channels,
      roles,
      roleName: (id) => roleNames.get(id) ?? 'unknown role',
      channelName: (id) => `#${channelNames.get(id) ?? id}`,
    });

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
  app.route('/permissions', permissionPages(deps));

  app.notFound((c) =>
    c.html(<Message title="Not found" text="There is no such page." />, 404),
  );
  app.onError((error, c) => {
    if (error instanceof UserError) {
      const section = `/${c.req.path.split('/')[1] ?? ''}`;

      return back(c, section, { error: error.message });
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
