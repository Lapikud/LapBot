# LAPbot

The Lapikud Discord bot: role selection, events with RSVPs, reminders,
birthdays, announcements, polls and movie nights.

TypeScript (strict, ESM) on Node.js 24, discord.js 14, PostgreSQL with
Drizzle ORM, one process with a persistent job scheduler.

## Setup

Requirements: Node.js 24+, pnpm (`corepack enable`), Docker (for local
PostgreSQL only).

```sh
pnpm install
cp .env.example .env          # fill in DISCORD_TOKEN and the role IDs
docker compose up -d
pnpm dev
```

The initial migration creates the current schema on a fresh database.
Migrations and Discord command registration run automatically when the bot starts.

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

Time input uses Chrono's English day-first parser: `30m`, `2 hours 30 minutes`,
`18:30`, `tomorrow at noon`, `Friday at 6pm`, `20/11 18:00`, or an explicit date.
Chrono owns the grammar; there are no custom clock, weekday or date parsers.
Yearless dates use slashes (`20/11`); full dotted dates such as `20.11.2026` also
work. Months and years follow calendar arithmetic. Inputs must be one complete
time expression, up to 100 characters; scheduling requires a future time.
The server's IANA timezone and DST rules apply to local appointments.

## Commands

| Command                                                                                         | Who                                                                                            |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `/remindme`, `/reminders list/edit/cancel`                                                      | everyone; `channel:` needs `reminder:channel`                                                  |
| `/announce create` (then Publish / Schedule / Edit / Discard), `/announce edit`                 | `announcement:create`, `:publish`, `:schedule`                                                 |
| `/event create/edit/cancel/list/view/attendees`, RSVP buttons                                   | create needs `event:create`; organizer or `event:manage` edits                                 |
| `/birthday set/remove/view/upcoming`, the **Add my birthday** button, `/birthday post/settings` | everyone; post and settings need `birthday:manage`                                             |
| `/poll create/list/results/close/cancel`                                                        | create needs `poll:create`; creator or `poll:manage` manages                                   |
| `/movie suggest/suggestions/link/remove/vote/night/watched/history`                             | vote, night, watched need `movie:manage`; link and remove need the suggester or `movie:manage` |
| `/permissions grant/revoke/list`                                                                | `permissions:manage`                                                                           |

## Web UI

Set `WEB_PORT` (and `DISCORD_GUILD_ID`) to start a small web UI next to the bot:
<http://localhost:3000>. Its five main sections are:

- **Overview:** upcoming activity and pending posts.
- **Post:** announcements, events, and polls, with shared section navigation.
- **Forms:** birthday and movie submissions.
- **Roles:** role selection and assignment.
- **Settings:** permissions and logs.

Post, Forms, and Settings open their first accessible subpage.

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
loaded from jsDelivr. Our own styles are in `src/web/public/app.css`; every file in
that directory is served as is.
Each flow has a local folder under `src/web/pages/overview`, `forms`, `post`, `roles`, or `settings`.
Its `routes.tsx` handles requests and calls services; `index.tsx` renders its main
page, with forms and other components beside it. Components receive explicit
data through props. Mount routes in `app.tsx` and add the flow to `navigation.ts`. Forms
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

## Development

| Script                                             | Purpose                                                     |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm dev`                                         | Run with reload (reads `.env`)                              |
| `pnpm build` / `pnpm start`                        | Compile to `dist/` and run it                               |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | Static checks                                               |
| `pnpm test`                                        | Vitest; set `TEST_DATABASE_URL` to run the PostgreSQL tests |
| `pnpm test:db`                                     | Start isolated PostgreSQL on localhost:5433                 |
| `pnpm test:integration`                            | Run all tests using `.env.test`                             |
| `pnpm db:generate`                                 | Create a migration after editing a `table.ts`               |

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

## Deploying

[`ci.yml`](.github/workflows/ci.yml) runs on every pull request: format check,
lint, typecheck, tests against a throwaway PostgreSQL, a test of `deploy.sh`
against a scratch folder ([`deploy-test.sh`](scripts/ci/deploy-test.sh)) and a
production build.

The LXC container can't be reached from the internet, so GitHub never connects
to it:

1. On every push to `main`, [`deploy.yml`](.github/workflows/deploy.yml) runs
   the same checks and, if they pass, pushes `main` to `git.lapikud.ee`.
2. That push starts [`.gitea/workflows/deploy.yml`](.gitea/workflows/deploy.yml)
   on a Gitea runner inside the container, which runs the pushed
   [`deploy.sh`](scripts/deploy/deploy.sh).

Everything lives in `/opt/lapbot`:

```text
.env            production settings, kept only on the server
logs/           the SQLite log archive, shared by every release
repo/           clone of the Gitea repo; releases are built from it
releases/<id>/  one built copy of the bot per deploy
current         symlink to the release systemd runs
```

`deploy.sh` resets `repo/` to `main`, builds a new release next to the live
one, points `current` at it and restarts the service. The bot applies
migrations on start, and the deploy passes once it logs `Ready`, meaning it is
logged in to Discord. If it doesn't within 90 seconds, `current` goes back to
the previous release and the service restarts. The last three releases are
kept.

- **Migrations can't be undone.** A rollback only changes the code, so each
  migration must also work with the release before it.
- **Deploys wait for each other.** If `main` moves during a deploy, the next
  one picks up the newest commit that passed CI.

### Server setup

As root, once, with PostgreSQL already running on the container:

1. Install Node 24, git and curl, then `corepack enable`.
2. Create the user and layout:

   ```sh
   useradd --system --create-home --home-dir /home/lapbot --shell /bin/bash lapbot
   usermod -aG systemd-journal lapbot
   install -d -o lapbot -g lapbot /opt/lapbot
   sudo -u lapbot git clone https://git.lapikud.ee/<owner>/lapbot.git /opt/lapbot/repo
   ```

3. Put the production settings, based on `.env.example`, in `/opt/lapbot/.env`,
   owned by `lapbot` and `chmod 600`.
4. Create `/etc/systemd/system/lapbot.service` and let `lapbot` restart it:

   ```ini
   [Unit]
   Description=LAPbot
   After=network-online.target postgresql.service
   Wants=network-online.target

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
   systemctl daemon-reload
   systemctl enable lapbot
   echo 'lapbot ALL=(root) NOPASSWD: /usr/bin/systemctl restart lapbot' > /etc/sudoers.d/lapbot
   chmod 440 /etc/sudoers.d/lapbot
   ```

5. Deploy once by hand: `sudo -u lapbot /opt/lapbot/repo/scripts/deploy/deploy.sh`.
6. Install [act_runner](https://docs.gitea.com/usage/actions/act-runner) and
   register it with the Gitea repo as `lapbot`, in host mode, with the `lapbot`
   label:

   ```sh
   sudo -u lapbot act_runner register --no-interactive \
     --instance https://git.lapikud.ee --token <registration token> \
     --name lapbot-lxc --labels lapbot:host
   ```

   Run it from `/home/lapbot` with a systemd unit (`User=lapbot`,
   `ExecStart=/usr/local/bin/act_runner daemon`). Anyone who can push to the
   Gitea repo can run code on the container as `lapbot`.

On GitHub, create a `production` environment with a `GITEA_REMOTE` secret:
`https://<user>:<token>@git.lapikud.ee/<owner>/lapbot.git`, using a token with
the `write:repository` scope.

The bot logs JSON to stdout (read it with `journalctl -u lapbot`) and shuts down
gracefully on `SIGTERM`: it stops taking interactions, finishes running jobs,
then closes Discord and the database.

Server administrators can open **Logs** in the dashboard to filter recent
entries by minimum level or search messages, sources and details. The page
refreshes every 10 seconds and can be paused while inspecting an entry.
All emitted entries are saved in full to SQLite at `LOG_DATABASE_PATH`
(default `logs/lapbot.sqlite`) and retained across restarts without automatic
deletion. The UI shows 100 entries per page and searches the complete archive.
Entries use the same `LOG_LEVEL` and field redaction as stdout. In production
the archive lives in `/opt/lapbot/logs`; back it up alongside the database.
Storage failures are reported to stderr while stdout logging continues.

## Architecture

The source has six top-level directories: config, core, features, integrations,
web, and discord. Feature records, rules, operations, and message views live
with their feature. Web pages and Discord commands each have one shared home.

```text
src/
  index.ts, app.ts          startup and explicit composition
  config/env.ts            validated environment
  core/                    reusable primitives, no feature dependencies
    forms/                 semantic fields and submission validation
    posts.ts, message.ts   post and message values, controls and pure rendering
    actor.ts, permission.ts, errors.ts
    helpers/               shared time, async, authorization and job helpers
    ports/                 external capability contracts
  features/
    <name>/                model, rules, forms, service and message views
                           as needed
  integrations/            implementations of external capabilities
    db/                    connection, migrations, and per-feature
                           <name>/table.ts and <name>/repository.ts
    discord/               SDK client, messaging, directory, calendar and API errors
    tmdb/, scheduler/, logging/
  web/
    overview/, forms/, post/, roles/, settings/
      <flow>/              routes.tsx, index.tsx, forms and local components
    components/            shared controls, selectors and previews
    public/                styles and other static assets
    app.tsx, auth.ts, context.ts, layout.tsx, navigation.ts, server.ts
  discord/
    commands/              slash/context commands, components and handlers.ts
    events/                event registration and reaction-role listeners
    interactions/          actor conversion, responses and routing
    contracts.ts, registry.ts, registration.ts, render.ts
tests/
  role-message, permissions, delivery, integrity
                           one .test.ts per critical concern
  db.ts, fakes.ts          shared test database and fakes
drizzle/                   SQL migrations
```

A feature's `model.ts` contains its records and repository contract. Other files
exist for actual responsibilities; there is no mandatory set to scaffold. Rules
and input definitions are pure; services orchestrate. Persistence lives in `integrations/db/<name>/`, which
implements the repository contract from the feature's `model.ts`.
Web flows are grouped into `web/pages/post`, `web/pages/forms`, `web/pages/roles`, and
`web/pages/settings`. Each flow owns its routes, submission decoding and components.
An `index.tsx` is a rendered page, never a re-export-only entry point. Discord commands live in
`discord/commands`; gateway event listeners live in
`discord/events`. Tests cover only critical
behavior and live flat in `tests/`, one file per concern: the role message,
permissions and privacy, duplicate delivery, and data integrity.

**Imports name their source.** Within a feature use `./model` or `./rules`;
across features use direct paths such as `~/features/events/service`. There are
no re-export-only barrels hiding ownership. `app.ts` connects services,
repositories, platform adapters and credentials.

**Dependency boundaries are linted at the file level.** Core code cannot
import features or integrations. Feature models, rules, input definitions,
renderers and services cannot import concrete adapters. They may depend on shared
core helpers and ports. Only Discord adapters and the
composition root use discord.js. Colocation grants no permission to reverse those
dependencies.

### Composing features

**Forms validate input.** `core/forms` uses Zod for semantic field definitions
and structured issues. Birthday's fixed form and real-calendar validation live
in `features/birthdays`; poll response choices and eligibility live in
`features/polls`. Adapters decode transport input; forms do not store responses,
coerce all values, or render HTML. Poll eligibility and state checks still run
inside the repository transaction.

```ts
import { parseBirthdaySubmission } from '~/features/birthdays/form';
import { validatePollResponse } from '~/features/polls/form';

parseBirthdaySubmission({ day: 29, month: 2 });
// { day: 29, month: 2, visibility: 'public' }
validatePollResponse([{ id: 11, label: 'Pizza' }], false, [11, 11]);
// [11]; [] clears a vote.
```

**Posts describe content.** A core Post is content with an optional heading
and explicit mention choices. It has no database ID, lifecycle, permission policy
or job scheduler. Pure `renderPost` constructs a Message; it does not perform I/O
or impose announcement-specific limits.

```ts
import { renderPost } from '~/core/posts';

const message = renderPost({ title: 'Update', content: 'Hello' });
await messenger.send(channelId, message);
```

**Announcements compose posts and publication.** The announcement feature owns
its drafts, edits, scheduled publication, cancellation, repository, author/channel
visibility, mention permissions and delivery claims. Its model extends Post;
`announcementView` uses `renderPost` and enforces the existing error/length policy.
Use `createAnnouncementService` from `features/announcements/service` for that
workflow. This is a concrete consumer, not a universal lifecycle for every post.

SQL still uses `announcements` and `announcement_status`. Existing permissions,
commands, URLs, messages, queued `announcements.publish` jobs, `{ announcementId }`
payloads, `announcement:<id>` keys and one-hour lateness handling are unchanged.
No migration or command registration is required for this reorganization.

**Messages project feature data.** Event and poll message constructors live beside
their respective models and services. They project current feature records, so
there is no second editable copy of an event or poll. `renderPoll` takes explicit
time; its service helper supplies the current time. Birthday greetings and reminders
use Messenger directly. Text still uses Discord mention
and timestamp syntax; transport-neutral values do not imply portable text.

**UI primitives stay small.** Feature pages compose `web/components/controls`,
`choices`, `field`, and `actions`. Labels, help and errors are linked to control
IDs. Supply distinct IDs for repeated names. Shared channel selectors in
`web/components/selectors.tsx` use already-loaded server data. Controls perform
no service or directory lookups. Keep transport input decoding in the page and authoritative
permissions in the service.

**Integrations implement capabilities.** The event feature maps its model into the
Calendar contract; the Discord calendar adapter owns SDK payloads and limits.
Events retain warning-and-continue synchronization behavior. The TMDB
contract lives in `core/ports` and are injected into feature services. Movies explicitly compose poll and event services. Supporting several
calendar destinations still requires persisted links and a separate migration;
one injected Calendar does not provide simultaneous multi-calendar support.

**Background work keeps its existing guarantees.** `defineJob` validates payloads;
Scheduler is implemented by pg-boss. Delivery is at-least-once with retries and
state checks. Announcement and birthday handlers claim before sending;
reminder handlers may duplicate a send after a crash. Permanent delivery failures
are not retried. Each feature owns its lateness policy.

### Adding a capability

Start with one directory under `features/` and the operation you need. Keep its
model and rules there; add critical tests to the matching concern file in
`tests/`. Add web pages under `web/`, Discord commands under `discord/`,
persistence under `integrations/db/<name>/`, and provider clients to
integrations. Wire them in `app.ts`.
Extract a primitive only when it has a useful independent contract; use an existing
core capability first. Do not create model/service/ports/index files just
to satisfy a template. Generate migrations or register commands only when those
external contracts actually change.

## Known limitations

- Anonymous polls hide voters in Discord, but the database stores who voted
  (needed to change votes), so database administrators can see votes.
- If the process dies between posting a reminder or event reminder and
  recording it, that message can be sent twice (at-least-once). Announcements
  and birthday wishes go the other way and can be lost
  instead.
- Birthday announcements are not sent for days the bot was entirely offline.
- User-facing text is English (the legacy panel and birthday wishes are
  Estonian).
- Native Discord polls are not used, because bot polls must persist and work
  with movie nights.
