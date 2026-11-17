# LAPbot

The Lapikud Discord bot: role selection, events with RSVPs, reminders,
birthdays, announcements, polls and movie nights, plus a web dashboard.

TypeScript on Node.js 24, discord.js 14, PostgreSQL with Drizzle, pg-boss for
scheduled jobs, Hono for the dashboard.

## Setup

Requires Node.js 24, pnpm (`corepack enable`) and Docker (local PostgreSQL only).

```sh
pnpm install
cp .env.example .env    # set DISCORD_TOKEN, DISCORD_APPLICATION_ID and the role IDs
docker compose up -d
pnpm dev
```

Migrations and command registration run when the bot starts.

### Discord application

1. Create an application at <https://discord.com/developers/applications>, add
   a bot, and copy the token and application ID into `.env`.
2. No privileged intents are needed.
3. Invite it with the `bot` and `applications.commands` scopes and these
   permissions: View Channels, Send Messages, Embed Links, Read Message
   History, Add Reactions, Manage Messages, Manage Roles, plus Mention
   Everyone for pinging unmentionable roles.
4. Move the bot's role above every role it should hand out.

### Configuration

All settings are environment variables, documented in `.env.example` and
validated at startup. Only `DISCORD_TOKEN` and `DATABASE_URL` are required.
Times use `DEFAULT_TIMEZONE` and accept input like `30m`, `18:30`,
`tomorrow at noon` or `20/11 18:00`.

## Features

| Command                                                             | Who                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| `/remindme`, `/reminders list/edit/cancel`                          | everyone; channel reminders need `reminder:channel`    |
| `/announce create/edit`                                             | `announcement:create`, `:publish`, `:schedule`         |
| `/event create/edit/cancel/list/view/attendees`                     | `event:create`; the organizer or `event:manage` edits  |
| `/birthday set/remove/view/upcoming/post/settings`                  | everyone; `post` and `settings` need `birthday:manage` |
| `/poll create/list/results/close/cancel`                            | `poll:create`; the creator or `poll:manage` manages    |
| `/movie suggest/suggestions/link/remove/vote/night/watched/history` | `vote`, `night` and `watched` need `movie:manage`      |
| `/permissions grant/revoke/list`                                    | `permissions:manage`                                   |

- **Announcements** longer than one Discord message are sent as several, with
  pings only on the first.
- **Role selection** panels are managed in the dashboard. The original
  `Valige endale rolli` message is imported once from
  `ROLE_SELECTION_CHANNEL_ID` and the role IDs; after that the database owns it.
  Moderator, managed and higher roles can't be offered.
- **Movies** are looked up on TMDB when `TMDB_ACCESS_TOKEN` is set.
- **Events** can be added to the club Google Calendar (public channels only),
  and creating one shows what is already on that day.

### Google Calendar

Share `lapikud@gmail.com` with a service account (**Make changes to events**),
then set `GOOGLE_CALENDAR_ID=lapikud@gmail.com` and
`GOOGLE_SERVICE_ACCOUNT_KEY` to its JSON key on one line.

### Permissions

Bot permissions such as `event:create` are granted to Discord roles and
stored in PostgreSQL.

- Everything restricted is denied unless one of the member's roles has a grant.
- Discord administrators hold every permission, so they make the first grants.
- Others with `permissions:manage` can only grant permissions they hold, to
  roles below their own, and never `permissions:manage` itself.
- Buttons and menus check permissions again on every press.

### Web dashboard

Set `WEB_PORT`, `DISCORD_GUILD_ID`, `DISCORD_CLIENT_SECRET` and
`SESSION_SECRET` (`openssl rand -hex 32`), and add `<WEB_URL>/login` as an
OAuth2 redirect in the Discord developer portal. Members sign in with Discord
and act with their own permissions. Only administrators can open it until they
grant `web:access`. It listens on `127.0.0.1`.

Administrators can read the logs under **Settings → Logs**. Logs are also kept
in SQLite at `LOG_DATABASE_PATH`.

## Development

| Script                                             | Purpose                                           |
| -------------------------------------------------- | ------------------------------------------------- |
| `pnpm dev`                                         | Run with reload                                   |
| `pnpm build`, `pnpm start`                         | Build to `dist/` and run it                       |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | Static checks                                     |
| `pnpm test`                                        | Tests; database tests skip without a database     |
| `pnpm test:db`, `pnpm test:integration`            | Start a throwaway test database and run all tests |
| `pnpm db:generate`                                 | Create a migration after editing a `table.ts`     |

The integration tests reset the test database's schema, so never point
`TEST_DATABASE_URL` at real data.

### Layout

```text
src/
  app.ts, index.ts   composition and startup
  config/            environment
  core/              shared primitives and ports (contracts); no feature imports
  features/<name>/   models, rules, services and message views
  integrations/      adapters: db/<name>/ tables and repositories, discord, tmdb, scheduler, logging
  web/               dashboard pages and components
  discord/           commands, listeners and interaction routing
tests/               one file per critical concern: role message, permissions, delivery, integrity
drizzle/             SQL migrations
```

Features depend on `core` and, where they compose, other features; lint blocks
them from importing adapters.
`app.ts` wires everything together. Imports use direct `~/` paths, with no barrel files.

## Deploying

Pull requests run [`ci.yml`](.github/workflows/ci.yml): formatting, lint,
types, tests against PostgreSQL, the deploy script tests and a build.

A push to `main` runs the same checks, then
[`deploy.yml`](.github/workflows/deploy.yml) pushes `main` to
`git.lapikud.ee`. There, [`.gitea/workflows/deploy.yml`](.gitea/workflows/deploy.yml)
runs [`deploy.sh`](scripts/deploy/deploy.sh) on a runner inside the LXC
container.

`deploy.sh` builds a new release in `/opt/lapbot/releases/`, points
`/opt/lapbot/current` at it and restarts the `lapbot` service. If the bot
doesn't log `Ready` within 90 seconds, it switches back to the previous
release. Migrations are not rolled back, so each one must also work with the
previous release.

### Server setup

As root, once, with PostgreSQL running on the container:

1. Install Node 24, git and act_runner, then run `corepack enable`.
2. Create the user and checkout:

   ```sh
   useradd --system --create-home --shell /bin/bash lapbot
   usermod -aG systemd-journal lapbot
   install -d -o lapbot -g lapbot /opt/lapbot
   sudo -u lapbot git clone https://git.lapikud.ee/<owner>/lapbot.git /opt/lapbot/repo
   ```

3. Write `/opt/lapbot/.env` (owned by `lapbot`, mode `600`).
4. Add `/etc/systemd/system/lapbot.service`:

   ```ini
   [Unit]
   Description=LAPbot
   After=network-online.target postgresql.service

   [Service]
   User=lapbot
   WorkingDirectory=/opt/lapbot/current
   EnvironmentFile=/opt/lapbot/.env
   Environment=NODE_ENV=production
   ExecStart=/usr/bin/node --enable-source-maps dist/index.mjs
   Restart=on-failure
   TimeoutStopSec=30

   [Install]
   WantedBy=multi-user.target
   ```

   ```sh
   systemctl daemon-reload && systemctl enable lapbot
   echo 'lapbot ALL=(root) NOPASSWD: /usr/bin/systemctl restart lapbot' > /etc/sudoers.d/lapbot
   chmod 440 /etc/sudoers.d/lapbot
   ```

5. Deploy once by hand: `sudo -u lapbot /opt/lapbot/repo/scripts/deploy/deploy.sh`.
6. Register the runner in host mode with the `lapbot` label, and run
   `act_runner daemon` as `lapbot` from a systemd unit:

   ```sh
   cd /home/lapbot && sudo -u lapbot act_runner register --no-interactive \
     --instance https://git.lapikud.ee --token <token> --name lapbot-lxc --labels lapbot:host
   ```

7. On GitHub, add a `production` environment with the secret `GITEA_REMOTE`
   set to `https://<user>:<token>@git.lapikud.ee/<owner>/lapbot.git`.

Logs: `journalctl -u lapbot`. Back up the database and `/opt/lapbot/logs`.

## Known limitations

- Anonymous polls hide voters in Discord, but the database still stores votes.
- A crash right after a reminder is posted can send it twice. A crash during an
  announcement or birthday post can lose that post.
- Birthdays are skipped for days the bot was fully offline.
