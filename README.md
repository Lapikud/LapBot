# LAPbot

The Lapikud Discord bot and web dashboard.

## Setup

Requires Node.js 24, pnpm and Docker.

```sh
pnpm install
cp .env.example .env
docker compose up -d
pnpm dev
```

Migrations and command registration run on start.

### Discord permissions

View Channels, Send Messages, Embed Links, Read Message History, Add Reactions,
Manage Messages and Manage Roles. The bot's role must be
above every role it hands out.

### Configuration

Settings are documented in `.env.example`.

- Role selection: `ROLE_SELECTION_CHANNEL_ID` and the role IDs.
- Movie details: `TMDB_ACCESS_TOKEN`.
- Google Calendar: `GOOGLE_CALENDAR_ID=lapikud@gmail.com` and
  `GOOGLE_SERVICE_ACCOUNT_KEY`.
- Dashboard: `WEB_PORT`, `DISCORD_GUILD_ID`, `DISCORD_CLIENT_SECRET` and
  `SESSION_SECRET`, with `<WEB_URL>/login` as an OAuth2 redirect.

## Permissions

| Command                                                             | Who                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| `/remindme`, `/reminders list/edit/cancel`                          | everyone; channel reminders need `reminder:channel`    |
| `/announce create/edit`                                             | `announcement:create`, `:publish`, `:schedule`         |
| `/event create/edit/cancel/list/view/attendees`                     | `event:create`; the organizer or `event:manage` edits  |
| `/birthday set/remove/view/upcoming/post/settings`                  | everyone; `post` and `settings` need `birthday:manage` |
| `/poll create/list/results/close/cancel`                            | `poll:create`; the creator or `poll:manage` manages    |
| `/movie suggest/suggestions/link/remove/vote/night/watched/history` | `vote`, `night` and `watched` need `movie:manage`      |
| `/permissions grant/revoke/list`                                    | `permissions:manage`                                   |
| Web dashboard                                                       | `web:access`                                           |

Discord administrators hold every permission and make the first grants.
Others can only grant permissions they hold, to roles below their own.

## Development

| Script                                             | Purpose                               |
| -------------------------------------------------- | ------------------------------------- |
| `pnpm dev`                                         | Run with reload                       |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | Static checks                         |
| `pnpm test:db`, `pnpm test:integration`            | Run all tests against a test database |
| `pnpm db:generate`                                 | Create a migration                    |

The integration tests reset the database schema. Never point
`TEST_DATABASE_URL` at real data.

```text
src/
  core/              shared primitives and ports
  features/<name>/   models, rules and services
  integrations/      adapters, including db/<name>/ tables and repositories
  web/               dashboard
  discord/           commands and listeners
  app.ts             wiring
tests/               role message, permissions, delivery, integrity
```

## Deploying

Pull requests run CI. A push to `main` runs CI, then mirrors to
`git.lapikud.ee`, where a runner in the LXC container runs
`scripts/deploy/deploy.py`. It builds a new release, restarts the `lapbot`
service and rolls back if the bot doesn't log `Ready` within 90 seconds.
Migrations are not rolled back, so each must work with the previous release.

### Server setup

As root, with PostgreSQL running:

1. Install Node 24, Python 3, git and act_runner, and run `corepack enable`.
2. Create the user and checkout:

   ```sh
   useradd --system --create-home --shell /usr/sbin/nologin lapbot
   usermod -aG systemd-journal lapbot
   install -d -o lapbot -g lapbot /opt/lapbot
   runuser -u lapbot -- git clone https://git.lapikud.ee/<owner>/lapbot.git /opt/lapbot/repo
   ```

   The clone must be at `/opt/lapbot/repo`: `deploy.py` builds every release
   from it.

3. Write `/opt/lapbot/.env` (owner `lapbot`, mode `600`).
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

5. Add the restart trigger, since `lapbot` has no sudo.
   `/etc/systemd/system/lapbot-restart.path`:

   ```ini
   [Path]
   PathModified=/opt/lapbot/.restart

   [Install]
   WantedBy=multi-user.target
   ```

   `/etc/systemd/system/lapbot-restart.service`:

   ```ini
   [Service]
   Type=oneshot
   ExecStart=/usr/bin/systemctl restart lapbot
   ```

   ```sh
   systemctl daemon-reload
   systemctl enable lapbot
   systemctl enable --now lapbot-restart.path
   ```

6. Deploy once: `runuser -u lapbot -- /opt/lapbot/repo/scripts/deploy/deploy.py`.
7. Register the runner and run `act_runner daemon` as `lapbot`:

   ```sh
   cd /home/lapbot && runuser -u lapbot -- act_runner register --no-interactive \
     --instance https://git.lapikud.ee --token <token> --name lapbot-lxc --labels lapbot:host
   ```

8. On GitHub, add a `production` environment with the secret `GITEA_REMOTE`:
   `https://<user>:<token>@git.lapikud.ee/<owner>/lapbot.git`.

Logs: `journalctl -u lapbot`. Back up the database and `/opt/lapbot/logs`.
