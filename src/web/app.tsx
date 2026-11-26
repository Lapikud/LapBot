import { applicationAdmin, webAccess } from '~/core/permission';
import { eventSuggestionRoutes } from '~/web/pages/events/suggestions/routes';
import { visibleRecords } from '~/core/helpers/visibility';
import { randomUUID } from 'node:crypto';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { UserError } from '~/core/errors';
import { signedInUser, signInPages } from './auth';
import { birthdayRoutes } from '~/web/pages/birthdays/routes';
import { back, serverOf, type Env, type Server, type WebDeps } from './context';
import { eventRoutes } from '~/web/pages/events/routes';
import { movieRoutes } from '~/web/pages/events/movies/routes';
import { logRoutes } from '~/web/pages/settings/logs/routes';
import { StatusPage } from './components/status-page';
import { HelpPage } from './pages/help/index';
import { helpRoutes } from './pages/help/routes';
import { containsPath, sections, visibleLinks } from './navigation';
import { permissionRoutes } from '~/web/pages/settings/permissions/routes';
import { roleRoutes } from '~/web/pages/settings/roles/routes';
import { pollRoutes } from '~/web/pages/polls/routes';
import { reminderRoutes } from '~/web/pages/reminders/routes';
import { announcementRoutes } from '~/web/pages/announcements/routes';

const moved = [
  ['/post/event-suggestions', '/events/suggestions'],
  ['/forms/movies', '/events/movies'],
  ['/forms/birthdays', '/birthdays'],
  ['/post/announcements', '/announcements'],
  ['/post/events', '/events'],
  ['/post/polls', '/polls'],
  ['/roles', '/settings/roles'],
] as const;

function returnPath(referer: string | undefined, path: string): string {
  const parts = path.split('/').filter(Boolean);
  const depth = parts[0] === 'settings' ? 2 : 1;
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
  const fetchMetadata = () =>
    Promise.all([
      directory.channels(guildId),
      directory.roles(guildId),
      directory.members(guildId),
    ]);
  let metadata: ReturnType<typeof fetchMetadata> | undefined;
  let expiresAt = 0;
  const getMetadata = () => {
    if (metadata === undefined || Date.now() >= expiresAt) {
      expiresAt = Number.POSITIVE_INFINITY;
      metadata = fetchMetadata().then((value) => {
        expiresAt = Date.now() + 30_000;

        return value;
      });
      void metadata.catch(() => {
        metadata = undefined;
      });
    }

    return metadata;
  };

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'"],
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
  app.get('/', async (c, next) =>
    (await signedInUser(c, signIn)) === undefined
      ? c.html(<HelpPage />)
      : next(),
  );
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

    const can = await authz.granted(actor, [
      applicationAdmin,
      webAccess,
      ...services.permissions.catalogue().map(({ id }) => id),
    ]);

    if (
      c.req.path === '/' &&
      !can.has(webAccess) &&
      can.has('event:suggestions:manage')
    ) {
      return c.redirect('/events/suggestions', 303);
    }

    if (
      !can.has(webAccess) &&
      !(
        can.has('event:suggestions:manage') &&
        (c.req.path === '/events/suggestions' ||
          c.req.path.startsWith('/events/suggestions/'))
      )
    ) {
      return c.html(
        <StatusPage
          title="No access yet"
          text="Ask a server administrator to give one of your roles access to the dashboard."
        />,
        403,
      );
    }

    c.set('actor', actor);
    c.set('can', can);
    let server: Promise<Server> | undefined;

    c.set(
      'server',
      () =>
        (server ??= getMetadata().then(async ([channels, roles, members]) => {
          const visible = await visibleRecords(
            directory,
            actor,
            channels.map((channel) => ({ ...channel, channelId: channel.id })),
          );

          return serverOf(visible, roles, members);
        })),
    );

    return next();
  });

  for (const [from, to] of moved) {
    app.get(`${from}/*`, (c) => {
      const { pathname, search } = new URL(c.req.url);

      return c.redirect(`${to}${pathname.slice(from.length)}${search}`, 301);
    });
    app.get(from, (c) => c.redirect(`${to}${new URL(c.req.url).search}`, 301));
  }

  for (const section of sections.filter(
    ({ href, pages }) =>
      pages !== undefined && !pages.some((page) => page.href === href),
  )) {
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

  app.route('/', helpRoutes(deps));
  app.route('/announcements', announcementRoutes(deps));
  app.route('/events/suggestions', eventSuggestionRoutes(deps));
  app.route('/events', eventRoutes(deps));
  app.route('/polls', pollRoutes(deps));
  app.route('/reminders', reminderRoutes(deps));
  app.route('/birthdays', birthdayRoutes(deps));
  app.route('/events/movies', movieRoutes(deps));
  app.route('/settings/roles', roleRoutes(deps));
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

    log.error({ error, ref, path: c.req.path }, 'Web request failed');

    return c.html(
      <StatusPage title="Something went wrong" text={`Reference: ${ref}`} />,
      500,
    );
  });

  return app;
}

export type WebApp = ReturnType<typeof createWebApp>;
