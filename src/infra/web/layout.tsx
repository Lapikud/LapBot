import type { Child } from 'hono/jsx';
import type { Flash, Server } from './context';

const sections = [
  ['/', 'Overview'],
  ['/events', 'Events'],
  ['/polls', 'Polls'],
  ['/birthdays', 'Birthdays'],
  ['/psa', 'PSAs'],
  ['/permissions', 'Permissions'],
] as const;

const pico =
  'https://cdn.jsdelivr.net/npm/@picocss/pico@2.1.1/css/pico.min.css';

export function Layout({
  title,
  path,
  flash = {},
  children,
}: Readonly<{ title: string; path: string; flash?: Flash; children?: Child }>) {
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
              {sections.map(([href, label]) => (
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
          </nav>
        </header>
        <main class="container">
          <h1>{title}</h1>
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

export function ChannelSelect({
  server,
  name = 'channelId',
}: Readonly<{ server: Server; name?: string }>) {
  return (
    <label>
      Channel
      <select name={name} required>
        {server.channels.map(({ id, name: channel }) => (
          <option key={id} value={id}>
            #{channel}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Checkbox({
  name,
  label,
  checked = false,
  value = '1',
}: Readonly<{
  name: string;
  label: string;
  checked?: boolean;
  value?: string;
}>) {
  return (
    <label>
      <input type="checkbox" name={name} value={value} checked={checked} />
      {label}
    </label>
  );
}

export function ActionButton({
  action,
  label,
}: Readonly<{ action: string; label: string }>) {
  return (
    <form method="post" action={action}>
      <button type="submit" class="secondary outline">
        {label}
      </button>
    </form>
  );
}
