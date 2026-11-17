import type { Child } from 'hono/jsx';
import { managePermissions, type Permission } from '~/domain';
import type { Flash } from './context';

const sections: ReadonlyArray<
  readonly [href: string, label: string, permission?: Permission]
> = [
  ['/', 'Overview'],
  ['/events', 'Events'],
  ['/polls', 'Polls'],
  ['/birthdays', 'Birthdays'],
  ['/movies', 'Movies'],
  ['/psa', 'PSAs', 'announcement:create'],
  ['/roles', 'Self-selection roles', managePermissions],
  ['/permissions', 'Permissions', managePermissions],
  ['/logs', 'Logs', managePermissions],
];

const pico =
  'https://cdn.jsdelivr.net/npm/@picocss/pico@2.1.1/css/pico.min.css';

export function Layout({
  title,
  path,
  can,
  flash = {},
  actions,
  children,
}: Readonly<{
  title: string;
  path: string;
  can?: ReadonlySet<Permission>;
  flash?: Flash;
  actions?: Child;
  children?: Child;
}>) {
  const visible = sections.filter(
    ([, , permission]) =>
      permission === undefined || can?.has(permission) === true,
  );

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${title} · LAPbot`}</title>
        <link rel="stylesheet" href={pico} />
        <link rel="stylesheet" href="/app.css" />
      </head>
      <body>
        <header class="container">
          <nav>
            <ul>
              <li>
                <strong>LAPbot</strong>
              </li>
            </ul>
            <ul>
              {(can === undefined ? [] : visible).map(([href, label]) => (
                <li key={href}>
                  <a
                    href={href}
                    aria-current={path === href ? 'page' : undefined}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
            <ul>
              <li>
                <form method="post" action="/logout">
                  <button type="submit" class="secondary outline">
                    Sign out
                  </button>
                </form>
              </li>
            </ul>
          </nav>
        </header>
        <main class="container">
          <div class="page-title">
            <h1>{title}</h1>
            {actions}
          </div>
          {flash.notice === undefined ? null : (
            <p class="notice" role="status">
              {flash.notice}
            </p>
          )}
          {flash.error === undefined ? null : (
            <p class="error" role="alert">
              {flash.error}
            </p>
          )}
          {children}
        </main>
      </body>
    </html>
  );
}
