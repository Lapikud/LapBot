# LAPbot

The Lapikud Discord bot: role selection, events with RSVPs, reminders,
birthdays, announcements, polls, movie nights and Redmine.

TypeScript (strict, ESM) on Node.js 24, discord.js 14, PostgreSQL with
Drizzle ORM, one process with a persistent job scheduler.

## Setup

Requirements: Node.js 24+, pnpm (`corepack enable`), Docker (for PostgreSQL).

```sh
pnpm install
cp .env.example .env          # fill in DISCORD_TOKEN and the role IDs
docker compose -f compose.yaml -f compose.dev.yaml up -d postgres
pnpm commands:register        # once, and after changing commands
pnpm dev
```

Migrations run automatically when the bot starts. `pnpm db:migrate` runs
them without starting the bot.

### Discord application

1. Create an application at <https://discord.com/developers/applications>,
   add a bot, and copy its token into `DISCORD_TOKEN` and the application ID
   into `DISCORD_APPLICATION_ID`.
2. **Gateway intents:** none of the privileged intents are needed. The bot
   uses only `Guilds` and `GuildMessageReactions`.
3. **Invite** with scopes `bot` and `applications.commands` and these
   permissions: View Channels, Send Messages, Embed Links, Read Message
   History, Add Reactions, Manage Roles, Manage Events (only for native
   Discord events), and Mention Everyone (only if announcements should ping
   roles that are not mentionable).
4. Drag the bot's role **above** every role it should hand out. Discord does
   not let it manage roles at or above its own.
5. Make the role selection channel read-only for members (they still need Add
   Reactions on the legacy panel).

### Configuration

All settings come from environment variables (see `.env.example`), validated
at startup. Only `DISCORD_TOKEN` and `DATABASE_URL` are required; each optional
feature asks only for what it needs.

Precedence: settings changed at runtime with bot commands (server timezone,
birthday channel) live in the database and win over environment defaults
(`DEFAULT_TIMEZONE`). Everything else is environment-only.

## Commands

| Command                                                                    | Who                                                            |
| -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `/role list`, role panels (button + select menu)                           | everyone                                                       |
| `/role create`, `delete`, `assign`, `remove`, `panel create/update/remove` | `role:create`, `role:manage`, `role:assign`                    |
| `/remindme`, `/reminders list/edit/cancel`                                 | everyone; `channel:` needs `reminder:channel`                  |
| `/announce create/preview/publish/schedule/edit/cancel`                    | `announcement:create`, `:publish`, `:schedule`                 |
| `/event create/edit/cancel/list/view/attendees`, RSVP buttons              | create needs `event:create`; organizer or `event:manage` edits |
| `/birthday set/remove/view/upcoming`, `/birthday settings`                 | everyone; settings need `birthday:manage`                      |
| `/poll create/list/results/close/cancel`                                   | create needs `poll:create`; creator or `poll:manage` manages   |
| `/movie suggest/suggestions/remove/vote/night/watched/history`             | vote, night, watched need `movie:manage`                       |
| `/redmine …`                                                               | see [Redmine](#redmine)                                        |
| `/permissions grant/revoke/list/check`                                     | `permissions:manage`                                           |
| `/settings timezone`                                                       | viewing is open; changing needs `settings:manage`              |

## Web UI

Set `WEB_PORT` (and `DISCORD_GUILD_ID`) to start a small web UI next to the bot:
<http://localhost:3000>. It covers:

- **PSAs:** write an announcement, choose one channel and exactly which roles
  (or @everyone) it mentions, preview it as Discord will show it, then publish
  now, schedule it, or save a draft.
- **Events, polls, permissions and the server timezone.**

The UI uses the same services as the slash commands, so the same rules apply:
it only posts where the bot can post, and only mentionable roles can be pinged
unless the bot may mention everyone.

**There is no sign-in yet.** Whoever can open the page acts as a server
administrator, which is why it listens on `127.0.0.1` only (Compose publishes
it on the host's loopback). Reach it from elsewhere through an SSH tunnel, not
a public proxy. Sign-in plugs in through the `Authenticator` port;
`createDiscordOAuth` in `src/infra/web/auth.ts` is a Discord OAuth2 adapter
that is written and tested but not connected yet.

## Permissions

The bot has its own action-based permissions (`event:create`, `poll:manage`,
…) granted to Discord roles per server and stored in PostgreSQL.

- Everything restricted is denied unless one of the member's roles has a grant.
  Grants from all roles combine.
- Members with Discord's **Administrator** permission hold every bot
  permission. That is how the first grants are made:
  `/permissions grant role:@Juhatus permission:event:create`.
- Granting to `@everyone` opens an action to all members.
- To prevent escalation, a non-administrator with `permissions:manage` can
  grant only permissions they hold themselves, only to roles below their
  own highest role, and never `permissions:manage`.
- Permissions are checked again on every button and menu press, not just when
  the message was created. Discord role hierarchy and Redmine's own
  permissions always apply on top.
- Every grant and revoke is logged.

## Role panels and migrating from reactions

The original reaction message (`Valige endale rolli: …` with 1️⃣ 2️⃣ 3️⃣) still
works when `ROLE_SELECTION_CHANNEL_ID` and the role IDs are set. On first start
the bot finds the message it posted before, or posts it once, and stores its
ID. It no longer reposts or searches on later starts, and reactions on any
other message are ignored.

Select-menu panels are the replacement. Members press **Choose roles** and get
a private menu showing the roles they already have. To migrate:

1. `/role panel create channel:#rollid title:Vali endale roll`
2. `/role panel update panel:<id> add:@Tarkvara`, then do the same for each role.
3. Announce the new panel. Members who reacted keep their roles.
4. When ready, an administrator runs `/role panel remove` on the legacy
   panel and clears `ROLE_SELECTION_CHANNEL_ID`. The bot never deletes the
   legacy message on its own.

Roles that grant moderator permissions, are managed by integrations, or sit
above the bot cannot be put on a panel.

## Redmine

Set `REDMINE_BASE_URL` and `CREDENTIAL_ENCRYPTION_KEY`
(`openssl rand -base64 32`) to enable it.

- Each member runs `/redmine link` and pastes their own Redmine API key
  (_My account → API access key_; the REST API must be enabled by a Redmine
  admin). The key is checked against Redmine, then stored encrypted
  (AES-256-GCM) with a key that never enters the database. `/redmine unlink`
  deletes it.
- Every user action (`projects`, `issues`, `issue view/create/update/assign/comment`)
  uses that member's own key, so Redmine decides what they can see and change.
  The bot permissions `redmine:issue:create`, `redmine:issue:update` and
  `redmine:issue:assign` are an additional gate, never a bypass.
- `/redmine issue remind` sets a personal DM reminder before an issue's due date.
- **Notifications:** with `REDMINE_API_KEY` (a dedicated, restricted service
  account) set, `/redmine subscribe project:<identifier>` posts new issues,
  status changes, assignments and comments to a channel, plus a daily "due
  tomorrow" digest. The bot polls every two minutes and asks only for issues
  updated since each subscription's stored checkpoint. Private issues and
  private notes are never posted. Anyone who can read the channel sees the
  updates, so subscribe only channels whose audience may see the project.
  Standard Redmine has no webhooks, so polling is the mechanism.

## Development

| Script                                             | Purpose                                                     |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm dev`                                         | Run with reload (reads `.env`)                              |
| `pnpm build` / `pnpm start`                        | Compile to `dist/` and run it                               |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | Static checks                                               |
| `pnpm test`                                        | Vitest; set `TEST_DATABASE_URL` to run the PostgreSQL tests |
| `pnpm db:generate`                                 | Create a migration after editing a `schema.ts`              |
| `pnpm db:migrate`                                  | Apply migrations                                            |
| `pnpm commands:register`                           | Register slash commands with Discord                        |

Database tests run against a real PostgreSQL and **reset its schema**, so
point `TEST_DATABASE_URL` at a throwaway database, for example:

```sh
docker run -d --name lapbot-test-pg -e POSTGRES_USER=lapbot -e POSTGRES_PASSWORD=lapbot \
  -e POSTGRES_DB=lapbot_test -p 127.0.0.1:55432:5432 postgres:17-alpine
TEST_DATABASE_URL=postgres://lapbot:lapbot@127.0.0.1:55432/lapbot_test pnpm test
```

Linting uses the shared baseline (typescript-eslint strict and stylistic, type
checked; sonarjs; unicorn) plus `eslint-plugin-import-x` for cycles and module
boundaries. `eslint-plugin-n` was left out because TypeScript and the
`import-x` rules already cover module resolution. `eslint-plugin-security`
was left out because its rules are mostly false positives on this kind of
code.

## Production

```sh
cp .env.example .env     # set DISCORD_TOKEN, POSTGRES_PASSWORD, …
docker compose up -d --build
docker compose logs -f bot
```

The image runs as a non-root user, applies migrations on start, logs JSON to
stdout, and shuts down gracefully on `SIGTERM`: it stops taking interactions,
finishes running jobs, then closes Discord and the database. PostgreSQL is not
published outside the Compose network. Back up the `pgdata` volume.

## Architecture

Ports and adapters. Business logic never imports discord.js, drizzle or an
HTTP client; it talks to ports, and adapters implement them.

```
src/
  index.ts            entry point: config, logging, signals
  app.ts              composition root: builds adapters, services, commands
  config/             validated environment
  domain/             pure types and rules: actors, permissions, messages,
                      time, polls, birthdays, issues
  lib/                generic helpers
  core/
    ports/            contracts: Messenger, Directory, Calendar, Scheduler,
                      IssueTracker, SecretBox and one repository per area
    services/         use cases (roles, reminders, events, polls, ...), each
                      created from its ports, with permission guards
  infra/
    db/<area>/        drizzle model and repository adapters
    discord/          discord.js client, router, outbound adapters and the
                      thin slash-command adapters in commands/
    scheduler/        job queue (Scheduler port) and the job runner
    redmine/          Redmine adapter for the IssueTracker port
    crypto/           AES-256-GCM SecretBox
    logging/          pino
    web/              server-rendered web UI and the Authenticator adapters
tests/                mirrors src/
drizzle/              SQL migrations
```

- **Boundaries are linted.** Modules import each other only through their
  barrel (`~/core/services`, never `~/core/services/roles`). The domain
  depends on nothing, core depends only on the domain, and only
  `infra/discord` may import discord.js.
- **Services take an `Actor`** (guild, user, roles, administrator), not a
  Discord member, and enforce permissions themselves. Any adapter that can
  produce an actor (Discord now, a web UI later) gets the same rules.
- **Messages are transport-neutral** (`domain/message.ts`): content, embeds,
  mentions and controls. `infra/discord/render.ts` turns them into discord.js
  payloads.
- **Cross-service use is explicit**: movies get the poll and event services,
  Redmine gets the reminder service.
- **Scheduler:** jobs live in `scheduled_jobs`. The runner claims due jobs
  with `FOR UPDATE SKIP LOCKED` and a lease, so a crash mid-job leads to a
  retry after the lease expires. Delivery is at-least-once, and handlers
  re-check current state. Where a duplicate message would be worse than a
  missed one (announcements, birthdays, Redmine notifications), the handler
  records the send before posting. Each handler decides what lateness means:
  late reminders are still delivered, overdue polls close, and announcements
  more than an hour late are skipped. Permanent delivery failures (closed DMs,
  deleted channels) are not retried.

### Adding a feature or integration

1. Domain rules go in `src/domain/<area>.ts`.
2. The contracts it needs go in `src/core/ports/<area>.ts`. Reuse `Messenger`,
   `Directory` and `Scheduler` where they fit.
3. The use cases go in `src/core/services/<area>.ts` as
   `create<Area>Service(deps)`, guarded with `guard(authz, 'area:action', ...)`.
   Background work is a `defineJob` in the service's `jobs`.
4. Adapters: a drizzle repository in `src/infra/db/<area>/`, plus
   `src/infra/discord/commands/<area>.ts` for slash commands. A new external
   system (another tracker, a calendar, a chat platform) is a new adapter
   implementing an existing port.
5. Wire it in `src/app.ts`, then run `pnpm db:generate` and
   `pnpm commands:register`.
6. Tests: `tests/domain`, `tests/core/services` (real Postgres plus the fakes in
   `tests/fakes.ts`) and `tests/infra`.

## Known limitations

- Anonymous polls hide voters in Discord, but the database stores who voted
  (needed to change votes), so database administrators can see votes.
- If the process dies between posting a reminder or event reminder and
  recording it, that message can be sent twice (at-least-once). Announcements,
  birthday wishes and Redmine notifications go the other way and can be lost
  instead.
- Redmine polling handles 25 changed issues per project per run. More than 25
  issues changed within the same second could keep the checkpoint from moving.
- Birthday announcements are not sent for days the bot was entirely offline.
- User-facing text is English (the legacy panel and birthday wishes are
  Estonian).
- The web UI has no sign-in yet (see [Web UI](#web-ui)).
- Native Discord polls are not used, because bot polls must persist and work
  with movie nights.
