import { visibleRecords } from '~/core/helpers/visibility';
import { randomUUID } from 'node:crypto';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { UserError } from '~/core/errors';
import { webAccess } from '~/core/permission';
import { signedInUser, signInPages } from './auth';
import { birthdayRoutes } from '~/web/forms/birthdays/routes';
import { back, serverOf, type Env, type WebDeps } from './context';
import { eventRoutes } from '~/web/post/events/routes';
import { movieRoutes } from '~/web/forms/movies/routes';
import { logRoutes } from '~/web/settings/logs/routes';
import { StatusPage } from './components/status-page';
import { overviewRoutes } from './overview/routes';
import { containsPath, sections, visibleLinks } from './navigation';
import { permissionRoutes } from '~/web/settings/permissions/routes';
import { roleRoutes } from '~/web/roles/routes';
import { pollRoutes } from '~/web/post/polls/routes';
import { announcementRoutes } from '~/web/post/announcements/routes';

function returnPath(referer: string | undefined, path: string): string {
  const parts = path.split('/').filter(Boolean);
  const depth = ['post', 'forms', 'settings'].includes(parts[0] ?? '') ? 2 : 1;
  const section = `/${parts.slice(0, depth).join('/')}`;
  const from = referer === undefined ? null : URL.parse(referer);

  if (from === null || !containsPath(section, from.pathname)) {
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
  app.use(serveStatic({ root: 'src/web/public' }));
  app.use(
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) =>
        c.html(
          <StatusPage title="Too large" text="That form is too large." />,
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
        <StatusPage
          title="Not a member"
          text="Your Discord account is not a member of the server."
        />,
        403,
      );
    }

    if (!(await authz.can(actor, webAccess))) {
      return c.html(
        <StatusPage
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

  for (const section of sections.filter(({ pages }) => pages !== undefined)) {
    app.get(section.href, (c) => {
      const allowed = visibleLinks([section], c.var.can)[0];
      const first = visibleLinks(allowed?.pages ?? [], c.var.can)[0];

      if (first === undefined) {
        return c.html(
          <StatusPage
            title="No access"
            text="You do not have access to this section."
            can={c.var.can}
          />,
          403,
        );
      }

      return c.redirect(`${first.href}${new URL(c.req.url).search}`, 303);
    });
  }

  app.route('/', overviewRoutes(deps));
  app.route('/post/announcements', announcementRoutes(deps));
  app.route('/post/events', eventRoutes(deps));
  app.route('/post/polls', pollRoutes(deps));
  app.route('/forms/birthdays', birthdayRoutes(deps));
  app.route('/forms/movies', movieRoutes(deps));
  app.route('/roles', roleRoutes(deps));
  app.route('/settings/permissions', permissionRoutes(deps));
  app.route('/settings/logs', logRoutes(deps.timezone, deps.logs));

  app.notFound((c) =>
    c.html(<StatusPage title="Not found" text="There is no such page." />, 404),
  );
  app.onError((error, c) => {
    if (error instanceof UserError && c.req.method === 'GET') {
      return c.html(
        <StatusPage title="Not allowed" text={error.message} can={c.var.can} />,
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
        <StatusPage
          title="Sign-in failed"
          text="Discord did not confirm the sign-in. Open the page again to retry."
        />,
        error.status,
      );
    }

    if (error instanceof HTTPException && error.status === 403) {
      return c.html(
        <StatusPage
          title="Forbidden"
          text="This form came from another site. Reload the page and try again."
        />,
        403,
      );
    }

    const ref = randomUUID().slice(0, 8);

    log.error({ err: error, ref, path: c.req.path }, 'Web request failed');

    return c.html(
      <StatusPage title="Something went wrong" text={`Reference: ${ref}`} />,
      500,
    );
  });

  return app;
}

export type WebApp = ReturnType<typeof createWebApp>;
