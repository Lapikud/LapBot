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

- Application administrators: set `JUHATUS_ROLE_ID` to the Juhatus Discord role ID.
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

Discord administrators and members of `JUHATUS_ROLE_ID` hold every bot permission.
Roles and Logs are admin-only. Losing Juhatus removes its admin access.

Grant permissions to a role or member with `/permissions grant/revoke`, using
`role:` or `user:`. Personal and role grants combine. Non-admins can only grant
permissions they hold, to roles or members below their own. Only admins can
delegate `permissions:manage`.

### Events

`/event suggest text:going to the park` saves an idea and posts it in the current
channel without pings. The dashboard inbox needs `event:suggestions:manage`,
which grants inbox access without `web:access`.

Calendar crossposting is opt-in and needs `event:calendar:publish`. Choose it when
creating an event, or use `/event calendar id:` or the dashboard to post an
existing event. Only public-channel events can be crossposted. Editing linked
calendar details needs the same permission; cancellation removes the entry.
Retry failed calendar posts from the existing event.

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

`deploy.py` reads these from the runner's environment:

| Variable               | Default                               | Purpose                        |
| ---------------------- | ------------------------------------- | ------------------------------ |
| `LAPBOT_ROOT`          | `/opt/lapbot`                         | Where releases and `.env` live |
| `LAPBOT_SERVICE`       | `lapbot`                              | The systemd service            |
| `LAPBOT_READY_TIMEOUT` | `90`                                  | Seconds to wait for `Ready`    |
| `LAPBOT_REMOTE`        | `origin` of the checkout it runs from | Where to clone `repo/` from    |

If you change the root or service, change the unit files below to match.

### Server setup

As root, with PostgreSQL running:

1. Install Node 24, Python 3, git and act_runner, and run `corepack enable`.
2. Create the user and root:

   ```sh
   useradd --system --create-home --shell /usr/sbin/nologin lapbot
   usermod -aG systemd-journal lapbot
   install -d -o lapbot -g lapbot /opt/lapbot
   ```

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

6. Register a repository-only runner and run `act_runner daemon` as `lapbot`:

   ```sh
   cd /home/lapbot && runuser -u lapbot -- act_runner register --no-interactive \
     --instance https://git.lapikud.ee --token <token> --name lapbot-lxc --labels lapbot:host
   ```

   The runner can read production secrets. Restrict Gitea pushes to trusted
   maintainers or use a read-only mirror.

   Private repo: set `LAPBOT_REMOTE` in the runner environment. Use an SSH URL,
   a read-only deploy key and configured known hosts.

7. In the Gitea repository, create an HTTPS deploy token with write access
   (disable read-only). On GitHub, add a `production` environment with a
   `GITEA_REMOTE` secret containing
   `https://<user>:<deploy-token>@git.lapikud.ee/<owner>/lapbot.git`.
8. Push to `main`. The first deploy clones `/opt/lapbot/repo`.

Logs: `journalctl -u lapbot`. Back up the database and `/opt/lapbot/logs`.
