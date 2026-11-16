import type { Child } from 'hono/jsx';
import type { Flash, Guild } from './context';

const sections = [
  ['/', 'Overview'],
  ['/psa', 'PSAs'],
  ['/events', 'Events'],
  ['/polls', 'Polls'],
  ['/permissions', 'Permissions'],
] as const;

export function Layout(
  props: Readonly<{
    title: string;
    path: string;
    flash?: Flash;
    children?: Child;
  }>,
) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${props.title} · LAPbot`}</title>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <header>
          <nav>
            <ul>
              <li>
                <strong>LAPbot</strong>
              </li>
            </ul>
            <ul>
              {sections.map(([href, label]) => (
                <li>
                  <a
                    href={href}
                    aria-current={props.path === href ? 'page' : undefined}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </header>
        <main>
          <h1>{props.title}</h1>
          {props.flash?.notice === undefined ? null : (
            <p class="notice" role="status">
              {props.flash.notice}
            </p>
          )}
          {props.flash?.error === undefined ? null : (
            <p class="error" role="alert">
              {props.flash.error}
            </p>
          )}
          {props.children}
        </main>
      </body>
    </html>
  );
}

export function ChannelSelect(
  props: Readonly<{ guild: Guild; name?: string }>,
) {
  return (
    <label>
      Channel
      <select name={props.name ?? 'channelId'} required>
        {props.guild.channels.map((channel) => (
          <option value={channel.id}>#{channel.name}</option>
        ))}
      </select>
    </label>
  );
}

export function Checkbox(
  props: Readonly<{
    name: string;
    label: string;
    checked?: boolean;
    value?: string;
  }>,
) {
  return (
    <label>
      <input
        type="checkbox"
        name={props.name}
        value={props.value ?? '1'}
        checked={props.checked}
      />
      {props.label}
    </label>
  );
}

export function ActionButton(
  props: Readonly<{ action: string; label: string }>,
) {
  return (
    <form method="post" action={props.action}>
      <button type="submit">{props.label}</button>
    </form>
  );
}
