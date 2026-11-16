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

Times are read and shown in `DEFAULT_TIMEZONE`. The birthday channel is set
with `/birthday settings` and lives in the database; everything else is
environment-only.

## Commands

| Command                                                                                         | Who                                                                                            |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `/remindme`, `/reminders list/edit/cancel`                                                      | everyone; `channel:` needs `reminder:channel`                                                  |
| `/announce create` (then Publish / Schedule / Edit / Discard), `/announce edit`                 | `announcement:create`, `:publish`, `:schedule`                                                 |
| `/event create/edit/cancel/list/view/attendees`, RSVP buttons                                   | create needs `event:create`; organizer or `event:manage` edits                                 |
| `/birthday set/remove/view/upcoming`, the **Add my birthday** button, `/birthday post/settings` | everyone; post and settings need `birthday:manage`                                             |
| `/poll create/list/results/close/cancel`                                                        | create needs `poll:create`; creator or `poll:manage` manages                                   |
| `/movie suggest/suggestions/link/remove/vote/night/watched/history`                             | vote, night, watched need `movie:manage`; link and remove need the suggester or `movie:manage` |
| `/redmine subscribe/unsubscribe`                                                                | `redmine:subscription:manage`                                                                  |
| `/permissions grant/revoke/list`                                                                | `permissions:manage`                                                                           |

## Web UI

Set `WEB_PORT` (and `DISCORD_GUILD_ID`) to start a small web UI next to the bot:
<http://localhost:3000>. It covers:

- **PSAs:** write an announcement, choose one channel and exactly which roles
  (or @everyone) it mentions, preview it as Discord will show it, then publish
  now, schedule it, or save a draft.
- **Events, polls and permissions.**

The UI uses the same services as the slash commands, so the same rules apply:
it only posts where the bot can post, and only mentionable roles can be pinged
unless the bot may mention everyone.

**Sign-in is with Discord.** Members sign in with their Discord account and
act as themselves, with their own bot permissions, so an event created here
is organized by whoever created it. Only server administrators can open the
dashboard at first; they give other roles access with the `web:access`
permission on the Permissions page, where each role's permissions are a list
of checkboxes. To set it up:

1. In the Discord developer portal, open the application → **OAuth2**, copy
   the **Client Secret** into `DISCORD_CLIENT_SECRET`, and add the redirect
   `<WEB_URL>/login` (for example `http://localhost:3000/login`).
2. Set `WEB_URL` if the UI is not opened at `http://localhost:<WEB_PORT>`.
3. Set `SESSION_SECRET` (`openssl rand -hex 32`) so sign-ins survive restarts;
   without it everyone signs in again after each restart.

Without `DISCORD_CLIENT_SECRET` the web UI stays off. It listens on
`127.0.0.1` by default; reach it from elsewhere through an SSH tunnel.

The pages are server-rendered [Hono](https://hono.dev) JSX styled by
[Pico.css](https://picocss.com) (classless, so plain form markup looks right),
loaded from jsDelivr. Our own styles are in `public/app.css`; every file in
`public/` is served as is.
Each section is one file in `src/infra/web/` that returns a small Hono app;
to add a page, write one and mount it with `app.route()` in `app.tsx`. Forms
post back to the same path, so there is no client-side JavaScript.

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
  the message was created. Discord role hierarchy always applies on top.
- Every grant and revoke is logged.

## Role selection

Members pick their own roles through Discord's **Server Settings → Onboarding**
(customization questions) and the **Channels & Roles** page. The bot has no
role commands.

The original reaction message (`Valige endale rolli: …` with 1️⃣ 2️⃣ 3️⃣) still
works when `ROLE_SELECTION_CHANNEL_ID` and the role IDs are set. On first start
the bot finds the message it posted before, or posts it once, and stores its
ID. It no longer reposts or searches on later starts, and reactions on any
other message are ignored. Roles that grant moderator permissions, are managed
by integrations, or sit above the bot are never handed out. To retire it,
clear `ROLE_SELECTION_CHANNEL_ID` and delete the message yourself.

## Movies

With `TMDB_ACCESS_TOKEN` set, each suggestion is looked up on
[TMDB](https://www.themoviedb.org): the bot stores the official title and
year, the synopsis, the poster and the YouTube trailer. Members can add their
own links (Letterboxd, IMDb, …) with `/movie link` or on the web Movies page.
Without a token, suggestions keep only what members type.

## Redmine

Set `REDMINE_BASE_URL` and `REDMINE_API_KEY` (a dedicated, restricted service
account) to enable it.

`/redmine subscribe project:<identifier>` posts new issues, status changes,
assignments and comments to a channel, plus a daily "due tomorrow" digest
(`/redmine unsubscribe` stops it; both need `redmine:subscription:manage`).
The bot polls every two minutes and asks only for issues updated since each
subscription's stored checkpoint. Private issues and private notes are never
posted. Anyone who can read the channel sees the updates, so subscribe only
channels whose audience may see the project. Standard Redmine has no
webhooks, so polling is the mechanism.

## Development

| Script                                             | Purpose                                                     |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm dev`                                         | Run with reload (reads `.env`)                              |
| `pnpm build` / `pnpm start`                        | Compile to `dist/` and run it                               |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | Static checks                                               |
| `pnpm test`                                        | Vitest; set `TEST_DATABASE_URL` to run the PostgreSQL tests |
| `pnpm test:db`                                     | Start isolated PostgreSQL on localhost:5433                 |
| `pnpm test:integration`                            | Run all tests using `.env.test`                             |
| `pnpm db:generate`                                 | Create a migration after editing a `schema.ts`              |
| `pnpm db:migrate`                                  | Apply migrations                                            |
| `pnpm commands:register`                           | Register slash commands with Discord                        |

Database tests run against a real PostgreSQL and **reset its schema**. Start
the dedicated test service, which uses temporary storage separate from the
development database:

```sh
pnpm test:db
pnpm test:integration
# Stop the test service and discard its data:
docker compose -f compose.test.yaml stop postgres-test
```

`.env.test` contains only local test credentials. An exported
`TEST_DATABASE_URL` overrides it; use a throwaway database only. `pnpm test`
still runs without PostgreSQL, skipping database tests when the variable is
unset. CI supplies its own PostgreSQL service and connection URL.

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
                      IssueTracker and one repository per area
    services/         use cases (roles, reminders, events, polls, ...), each
                      created from its ports, with permission guards
  infra/
    db/<area>/        drizzle model and repository adapters
    discord/          discord.js client, router, outbound adapters and the
                      thin slash-command adapters in commands/
    scheduler/        pg-boss adapter for the Scheduler port
    redmine/          Redmine adapter for the IssueTracker port
    logging/          pino
    web/              Hono + Pico web UI and its Authenticator adapter
tests/                mirrors src/
drizzle/              SQL migrations
```

- **Boundaries are linted.** Modules import each other only through their
  barrel (`~/core/services`, never `~/core/services/roles`). The domain
  depends on nothing, core depends only on the domain, and only
  `infra/discord` may import discord.js.
- **Services take an `Actor`** (server, user, roles, administrator), not a
  Discord member, and enforce permissions themselves. Any adapter that can
  produce an actor (Discord now, a web UI later) gets the same rules.
- **Messages are transport-neutral** (`domain/message.ts`): content, embeds,
  mentions and controls. `infra/discord/render.ts` turns them into discord.js
  payloads.
- **Cross-service use is explicit**: movies get the poll and event services.
- **Scheduler:** jobs run on [pg-boss](https://github.com/timgit/pg-boss) in
  the `pgboss` schema, one queue per job type with one queued job per key.
  A failed job is retried up to 4 times with backoff, and a crash mid-job
  leads to a retry once the job expires. Delivery is at-least-once, and handlers
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
