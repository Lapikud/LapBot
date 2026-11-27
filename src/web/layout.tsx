import type { Child } from 'hono/jsx';
import type { Permission } from '~/core/permission';
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
        <script src="/confirm.js" defer />
      </head>
      <body>
        <a class="skip-link" href="#content">
          Skip to content
        </a>

        <header class="app-header">
          <div class="container header-content">
            <a href="/" class="brand">
              LAPbot
            </a>

            <nav class="primary-nav" aria-label="Primary">
              {visible.map(({ href, label, pages: destinations }) => (
                <a
                  key={href}
                  href={visibleLinks(destinations ?? [], can)[0]?.href ?? href}
                  aria-current={section?.href === href ? 'true' : undefined}
                >
                  {label}
                </a>
              ))}
            </nav>

            <div class="account">
              {signedIn ? (
                <form method="post" action="/logout">
                  <button type="submit" class="secondary outline">
                    Sign out
                  </button>
                </form>
              ) : (
                <a href="/login">Sign in</a>
              )}
            </div>
          </div>
        </header>

        {pages.length > 0 && (
          <div class="section-header">
            <nav
              class="container section-nav"
              aria-label={`${section?.label} pages`}
            >
              {pages.map(({ href, label }) => (
                <a
                  key={href}
                  href={href}
                  aria-current={href === current ? 'page' : undefined}
                >
                  {label}
                </a>
              ))}
            </nav>
          </div>
        )}

        <main class="container" id="content">
          <div class="page-title">
            <h1>{title}</h1>
            {actions === undefined ? null : (
              <div class="page-actions">{actions}</div>
            )}
          </div>

          {flash.notice !== undefined && (
            <output class="notice">{flash.notice}</output>
          )}

          {flash.error !== undefined && (
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
