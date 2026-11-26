import type { Child } from 'hono/jsx';
import { type Permission } from '~/core/permission';
import type { Flash } from './context';
import {
  containsPage,
  containsPath,
  sections,
  visibleLinks,
} from './navigation';

const pico =
  'https://cdn.jsdelivr.net/npm/@picocss/pico@2.1.1/css/pico.min.css';

export function Layout({
  title,
  path,
  can,
  signedIn = true,
  flash = {},
  actions,
  children,
}: Readonly<{
  title: string;
  path: string;
  can?: ReadonlySet<Permission> | undefined;
  signedIn?: boolean;
  flash?: Flash;
  actions?: Child;
  children?: Child;
}>) {
  const visible = visibleLinks(sections, can);
  const section = visible.find((item) => containsPage(item, path));
  const pages = visibleLinks(section?.pages ?? [], can);
  const current = pages
    .filter(({ href }) => containsPath(href, path))
    .toSorted((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${title} · LAPbot`}</title>
        <link rel="stylesheet" href={pico} />
        <link rel="stylesheet" href="/app.css" />
        <script src="/nav.js" defer />
      </head>
      <body>
        <header class="container">
          <nav class="primary-nav" aria-label="Primary">
            <ul>
              <li>
                <strong>LAPbot</strong>
              </li>
            </ul>
            {visible.length === 0 ? null : (
              <button
                type="button"
                class="nav-menu-button"
                popovertarget="primary-links"
                aria-controls="primary-links"
              >
                Menu
              </button>
            )}
            <ul id="primary-links" class="primary-links" popover="auto">
              {visible.map(({ href, label, pages: destinations }) => (
                <li key={href}>
                  <a
                    href={
                      visibleLinks(destinations ?? [], can)[0]?.href ?? href
                    }
                    aria-current={section?.href === href ? 'page' : undefined}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
            <ul>
              <li>
                {signedIn ? (
                  <form method="post" action="/logout">
                    <button type="submit" class="secondary outline">
                      Sign out
                    </button>
                  </form>
                ) : (
                  <a href="/login" role="button" class="secondary outline">
                    Sign in
                  </a>
                )}
              </li>
            </ul>
          </nav>
        </header>
        <main class="container">
          {pages.length === 0 ? null : (
            <nav class="section-nav" aria-label={`${section?.label} pages`}>
              <ul>
                {pages.map(({ href, label }) => (
                  <li key={href}>
                    <a
                      href={href}
                      aria-current={href === current ? 'page' : undefined}
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
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
