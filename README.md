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

Times are read and shown in `DEFAULT_TIMEZONE`. Birthday settings and
self-selection role panels live in the database. Connection settings come
from the environment.

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

Server administrators manage reaction panels on **Self-selection roles** in the
web dashboard. Choose a channel, pair existing Discord roles with standard
emojis, then **Save reaction panel**. The bot creates or updates one panel per
channel. Use **Add role** to add a choice with a suggested emoji; each existing
choice has a **Remove** button. Members react to receive a role and remove their
reaction to leave it.
Up to 20 choices are supported per panel; custom server emojis are not supported.
Use **Remove** to remove a choice. The bot needs **Manage Messages** in the
panel channel to clear obsolete reactions when choices are removed or changed.
This keeps roles already held by members;
reactions for removed choices no longer change roles.

Moderator roles, integration-managed roles, @everyone and roles above the bot
are blocked. The bot needs Manage Roles, and its role must be above every
selectable role. Only Discord server administrators can configure panels.

The original reaction message (`Valige endale rolli: …` with 1️⃣ 2️⃣ 3️⃣) is
imported when `ROLE_SELECTION_CHANNEL_ID` and the role IDs are configured.
After import, the database owns its choices: web changes survive restarts and
are not overwritten by environment settings. Saving also recreates a deleted
panel message. New panels can be configured entirely through the dashboard.

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

Server administrators can open **Logs** in the dashboard to filter recent
entries by minimum level or search messages, sources and details. The page
refreshes every 10 seconds and can be paused while inspecting an entry.
All emitted entries are saved in full to SQLite at `LOG_DATABASE_PATH`
(default `logs/lapbot.sqlite`) and retained across restarts without automatic
deletion. The UI shows 100 entries per page and searches the complete archive.
Entries use the same `LOG_LEVEL` and field redaction as stdout. Docker Compose
persists the archive in the `botlogs` volume; back it up alongside `pgdata`.
Storage failures are reported to stderr while stdout logging continues.

## Architecture

Ports and adapters. Business logic never imports discord.js, drizzle or an
HTTP client; it talks to ports, and adapters implement them.

```
src/
  index.ts            entry point: config, logging, signals
  app.ts              composition root: builds adapters, services, commands
  config/             validated environment
  domain/             pure types and rules: actors, permissions, messages,
                      time, input definitions, polls, birthdays, issues
  lib/                generic helpers
  core/
    presentation/     pure post/event/poll message construction
    calendar/         pure event-to-calendar mapping
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
    web/              Hono + Pico pages, ui/ controls, server-aware selectors,
                      and its Authenticator adapter
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

### Composing features

Input, presentation, publication, and external access are separate building
blocks. A feature composes the parts it needs; it does not inherit a generic
feature lifecycle.

**Input definitions.** `src/domain/forms/` uses the existing Zod dependency for
semantic fields and structured validation. `birthdayForm` is a fixed definition;
`parseBirthdaySubmission` applies the existing visibility fallback and validates
real calendar dates. `pollResponseForm(options, multiple)` defines numeric option
choices, while `validatePollResponse` preserves vote deduplication and clearing.
Poll state and eligibility checks still run inside the repository transaction.
The form layer neither stores responses nor renders HTML.

```ts
import { parseBirthdaySubmission, validatePollResponse } from '~/domain';

const birthday = parseBirthdaySubmission({ day: 29, month: 2 });
// { day: 29, month: 2, visibility: 'public' }
const choices = validatePollResponse(
  [
    { id: 11, label: 'Pizza' },
    { id: 22, label: 'Sushi' },
  ],
  false,
  [22, 22],
);
// [22]; [] clears the vote. IDs remain numbers.
```

Transport adapters decode their own inputs. The shared validator preserves
omission, empty strings, explicit null, and empty arrays; it does not introduce
universal coercion or defaults. Feature adapters translate field issues into
the existing public errors. Configurable forms and shared response tables are
outside the current foundation.

**Web controls.** Pages compose `Input`, `Textarea`, `Select`, `Checkbox`,
`MultiSelect`, `FormActions`, and `ActionButton` from `src/infra/web/ui/`.
Labels, help, and errors are associated with the control ID. Give explicit,
distinct IDs when the same name occurs more than once on a page. Channel
selectors in `selectors.tsx` compose these controls using already-loaded server
data. Generic controls perform no service or directory lookups.

```tsx
import { Input } from './ui';

<Input
  name="day"
  id="birthday-day"
  label="Day"
  type="number"
  min={1}
  max={31}
  required
  help="Your birthday day, without the year"
/>;
```

Keep request parsing in the page adapter and authoritative authorization in the
service. Native HTML remains appropriate for specialized tables, role editor
rows, and unusual layouts.

**Managed posts.** `createPostService` owns draft, edit, immediate/scheduled
publication, cancellation, and delivery claims. It uses `PostRepository`, backed
by the existing `announcements` table; there are no new tables or migrations.
User operations take an Actor and enforce the existing `announcement:*`
permissions, author visibility, destination access, and mention restrictions.
The old announcement service/repository names are compatibility facades over
this single implementation.

```ts
// With the composed PostService and authenticated Actor:
const draft = await posts.draft(actor, {
  channelId: 'general',
  content: 'Hello',
});
await posts.publish(actor, draft.id);
// Or: await posts.schedule(actor, draft.id, 'tomorrow 9:00');
```

Publication jobs retain `announcements.publish`, `{ announcementId }`, and
`announcement:<id>` keys so queued work remains compatible. Their existing
one-hour lateness policy and claim-before-send tradeoff are unchanged.

**Message presentation and ordinary delivery.** Pure constructors in
`src/core/presentation/` return Message values. `postView`, `eventView`,
`pollView`, and `pollDetails` contain formatting, not I/O. Feature services keep
state and orchestration. The pure poll renderer takes an explicit `now`; the
legacy service renderer supplies current time for existing callers. Event/poll posts project their feature records, so
there is no second editable copy of event details or poll options. Birthday
greetings, reminders, and issue notifications use Messenger directly; they do
not need managed Post records.

```ts
await messenger.send(channelId, { content: 'A one-time notification' });
```

Text still contains Discord mentions and timestamps. The Message structure and
SDK adapter are separate, but these renderers are not yet portable text
renderers for arbitrary chat providers.

**External capabilities.** Calendar has its own port; `eventCalendarEntry` maps
event data into it, and `createDiscordCalendar` owns SDK calls and payload limits.
The event service decides when to sync and retains warning-and-continue failure
handling. MovieCatalog/TMDB and IssueTracker/Redmine follow the same capability
boundary. Wire concrete adapters and credentials in `src/app.ts`.

Supporting multiple calendar destinations later needs persisted
provider/destination links, per-link external IDs, opt-in state, and a reviewed
backfill. Existing `native` and `discordEventId` remain compatible; injecting
one Calendar does not provide simultaneous multi-calendar support.

### Adding a feature or integration

1. Put pure feature rules in `src/domain/`. Reuse semantic input definitions
   where there is actual shared validation; do not invent a schema engine.
2. Add only the contracts the feature needs under `src/core/ports/`. Reuse
   Messenger, Directory, Calendar, and Scheduler when they fit.
3. Implement actor-authorized use cases in `src/core/services/`. Use the Post
   service for managed publication and Messenger for ordinary delivery. Jobs
   use the existing `defineJob` and Scheduler contracts.
4. Put pure message construction in `src/core/presentation/`; compose web
   controls from `src/infra/web/ui/` without moving feature policy into them.
5. Add provider/database/command adapters and wire them in `src/app.ts`.
   Generate migrations or register commands only if those contracts change.
6. Verify the relevant domain, service, adapter, and web behaviors. Database
   tests use the dedicated disposable PostgreSQL; see Development above.

## Known limitations

- Anonymous polls hide voters in Discord, but the database stores who voted
  (needed to change votes), so database administrators can see votes.
- If the process dies between posting a reminder or event reminder and
  recording it, that message can be sent twice (at-least-once). Announcements,
  birthday wishes and Redmine notifications go the other way and can be lost
  instead.
- Redmine changes and deadlines are fetched in pages until all matching
  issues have been processed. Failed sends are retried on subsequent runs;
  a process crash after claiming a notification can still lose that message.
- Birthday announcements are not sent for days the bot was entirely offline.
- User-facing text is English (the legacy panel and birthday wishes are
  Estonian).
- Native Discord polls are not used, because bot polls must persist and work
  with movie nights.
