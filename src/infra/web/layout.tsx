import type { Child } from 'hono/jsx';
import { managePermissions, type Permission } from '~/domain';
import type { Flash, Server } from './context';

const sections: ReadonlyArray<
  readonly [href: string, label: string, permission?: Permission]
> = [
  ['/', 'Overview'],
  ['/events', 'Events'],
  ['/polls', 'Polls'],
  ['/birthdays', 'Birthdays'],
  ['/movies', 'Movies'],
  ['/psa', 'PSAs', 'announcement:create'],
  ['/permissions', 'Permissions', managePermissions],
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

export function ChannelOptions({
  server,
  selected,
}: Readonly<{ server: Server; selected?: string | undefined }>) {
  return (
    <>
      {server.channels.map(({ id, name }) => (
        <option key={id} value={id} selected={selected === id}>
          #{name}
        </option>
      ))}
    </>
  );
}

export function ChannelSelect({
  server,
  name = 'channelId',
  selected,
}: Readonly<{ server: Server; name?: string; selected?: string | undefined }>) {
  return (
    <label>
      Channel
      <select name={name} required>
        <ChannelOptions server={server} selected={selected} />
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

export type Choice = { name: string; value: string; label: string };

export function MultiSelect({
  label,
  placeholder,
  choices,
  selected,
}: Readonly<{
  label: string;
  placeholder: string;
  choices: readonly Choice[];
  selected: ReadonlySet<string>;
}>) {
  const picked = choices.filter(({ value }) => selected.has(value));

  return (
    <fieldset>
      <legend>{label}</legend>
      <details class="dropdown">
        <summary>
          {picked.length === 0
            ? placeholder
            : picked.map((choice) => choice.label).join(', ')}
        </summary>
        <ul>
          {choices.map((choice) => (
            <li key={`${choice.name}:${choice.value}`}>
              <label>
                <input
                  type="checkbox"
                  name={choice.name}
                  value={choice.value}
                  checked={selected.has(choice.value)}
                />
                {choice.label}
              </label>
            </li>
          ))}
        </ul>
      </details>
    </fieldset>
  );
}
