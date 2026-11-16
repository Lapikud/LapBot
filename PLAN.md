# LapBot: Complete Implementation and Architecture Instructions

## Role and objective

You are a senior TypeScript engineer, software architect, and experienced Discord application developer.

You are working on the existing repository:

**`lapikud/lapbot`**

GitHub: [https://github.com/lapikud/lapbot](https://github.com/lapikud/lapbot)

Your task is to evolve the existing JavaScript Discord bot into a production-ready, highly extensible, modular Discord application for the Lapikud student organization.

**This is not a greenfield project. Build on the existing codebase. Do not rewrite the application from scratch or create a separate application.**

Preserve existing behavior, improve correctness, introduce an extensible architecture, and progressively implement new capabilities.

The application must initially support:

1. Role management and self-service role selection.
2. Event creation, publishing, and RSVPs.
3. Personal, channel, and recurring reminders.
4. Birthday management and announcements.
5. Announcement creation and scheduling.
6. Poll creation and voting.
7. Movie suggestions, voting, and movie nights.
8. Redmine integration.
9. Centralized role-based permissions.
10. Persistent background scheduling.

The application should be designed so that future features can be added without substantial modifications to the core or unrelated modules.

The result should be a maintainable, extensible community utility application, not a generic Discord bot framework.

---

## 1. Fundamental engineering principles

Follow these principles throughout the implementation.

### 1.1 Intentional evolution

- Start simple, evolve deliberately.
- Introduce complexity only when required.
- Preserve working behavior during refactoring.
- Prefer reversible architectural decisions.
- Make dependencies and contracts explicit.
- Scale when actual constraints justify it.
- Choose clarity over cleverness.
- Prioritize maintainability and correctness.
- Keep abstractions proportional to the problems they solve.

Before introducing a dependency, abstraction, or architectural mechanism, consider:

- Does this reduce essential complexity?
- Is this solving a real problem?
- Is the decision reversible?
- Will the architecture remain understandable in two years?
- Does the proposed abstraction have multiple concrete consumers?
- Is there a simpler design that preserves the required behavior?

Do not avoid sophisticated implementations when they are genuinely necessary for correctness, concurrency, security, or reliability.

### 1.2 Architecture

Use a **feature-oriented modular monolith**.

Initially, deploy the application as a single Node.js process.

Avoid:

- Microservices.
- Unnecessary event buses.
- Generic plugin marketplaces.
- Reflection-based dependency injection.
- Service locator patterns.
- Excessive inheritance.
- Excessive generic programming.
- Unnecessary repository abstractions.
- Redis or RabbitMQ without a demonstrated need.
- Multiple independent schedulers.
- Duplicated feature implementations.
- Boilerplate files with no meaningful responsibility.

Prefer direct composition, explicit interfaces, small functions, and clear module boundaries.

### 1.3 Code quality

- Use idiomatic modern TypeScript.
- Prefer explicit contracts at module boundaries.
- Use inference for obvious local types.
- Avoid `any`.
- Avoid unjustified type assertions.
- Prefer `unknown` for untrusted information.
- Validate external input.
- Handle asynchronous failures.
- Do not swallow errors.
- Do not add code comments that merely repeat what the code already says.
- Use comments only when explaining non-obvious behavior, constraints, or decisions.
- Do not prematurely optimize.
- Do not implement speculative requirements.

Follow the Unix philosophy where applicable: components should have clear responsibilities and compose well.

---

## 2. Repository inspection

Before modifying anything, inspect the actual repository.

Read:

- `package.json`.
- Existing JavaScript source files.
- Existing configuration.
- Existing ESLint and Prettier configuration.
- Existing TypeScript configuration, if any.
- Existing test files.
- Existing Docker and deployment configuration.
- Existing CI workflows.
- Existing documentation.
- Existing environment-variable usage.
- Existing Git status.

Determine:

1. What functionality already exists?
2. Which dependencies are currently installed?
3. What is the existing execution model?
4. Which functionality must remain compatible?
5. What can be refactored safely?
6. Which changes require a migration?
7. Which files should be retained?
8. Which assumptions in the proposed architecture conflict with the actual repository?

Do not overwrite unrelated work.

Do not assume the remote repository and local working tree are identical.

If repository access is unavailable, use the supplied source as the baseline and clearly distinguish verified repository details from assumptions.

Briefly document your findings before implementing changes.

**After inspection, continue implementation. Do not stop at the architectural proposal.**

---

## 3. Existing functionality

The original application uses:

- JavaScript.
- CommonJS.
- `dotenv`.
- `discord.js`.
- Discord Gateway events.

It implements reaction-based role selection.

The role-selection message is:

```text
Valige endale rolli:
1 - Tarkvara
2 - Helpdesk
3 - Kultuur
```

The role mappings are:

| Reaction | Role |
| -------- | -------- |
| 1️⃣ | Tarkvara |
| 2️⃣ | Helpdesk |
| 3️⃣ | Kultuur |

The bot currently:

- Connects to Discord.
- Creates the role-selection message if it cannot find an existing one among recently fetched messages.
- Adds the corresponding reactions.
- Assigns roles when members add reactions.
- Removes roles when members remove reactions.
- Contains a disabled welcome-message implementation.

Existing environment variables include:

```dotenv
DISCORD_TOKEN=
ROLE_SELECTION_CHANNEL_ID=
TARKVARA_ROLE_ID=
HELPDESK_ROLE_ID=
KULTUUR_ROLE_ID=
WELCOME_CHANNEL_ID=
```

Retain compatibility with these variables during migration where practical.

## 3.1 Stabilize the existing implementation

Fix known issues before substantially extending it:

- Configure the necessary Discord partials for uncached reaction events.
- Verify the guild, channel, and message ID before performing role changes.
- Prevent reactions on unrelated messages from affecting roles.
- Do not rely exclusively on searching the most recent five messages.
- Persist or explicitly configure the role-selection message ID.
- Avoid creating duplicate messages.
- Validate configured IDs.
- Validate role existence.
- Respect Discord role hierarchy.
- Ensure the bot has appropriate permissions.
- Handle failed Discord API operations.
- Ignore bot reactions.
- Avoid unnecessary privileged Gateway Intents.
- Ensure asynchronous event-handler errors are handled.

Preserve reaction-based role selection initially.

Then introduce dropdown-based role selection as the preferred replacement.

Provide an explicit migration strategy.

Never automatically delete the original role-selection message without administrator approval.

---

## 4. Technology stack

Use the following technologies unless repository inspection reveals a strong reason not to.

| Component           | Technology                                               |
| ------------------- | -------------------------------------------------------- |
| Runtime             | Node.js 24 LTS                                           |
| Language            | TypeScript                                               |
| Discord integration | discord.js                                               |
| Package manager     | pnpm, if compatible with existing repository conventions |
| Database            | PostgreSQL                                               |
| ORM                 | Drizzle ORM                                              |
| Validation          | Zod                                                      |
| Testing             | Vitest                                                   |
| Logging             | Pino                                                     |
| HTTP client         | Native `fetch`                                           |
| Formatting          | Prettier                                                 |
| Linting             | ESLint flat configuration                                |
| Type improvements   | `@total-typescript/ts-reset`                             |
| Deployment          | Docker Compose, unless existing deployment is preferable |

Verify current compatible dependency versions before installation.

Prefer stable releases.

Use ESM and modern TypeScript conventions when feasible.

For ESM, ensure import paths, emitted JavaScript, package configuration, and TypeScript module resolution work consistently.

Do not migrate the package manager or module system without considering effects on the existing deployment.

---

## 5. TypeScript configuration

Migrate the existing JavaScript implementation to TypeScript incrementally.

Use strict TypeScript settings.

Evaluate:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "noEmitOnError": true
  }
}
```

These are starting requirements, not a complete `tsconfig.json`.

Configure `rootDir`, `outDir`, `include`, `exclude`, source maps, and relevant Node.js types appropriately.

Do not enable incompatible compiler settings merely to satisfy a checklist.

Avoid disabling type checking globally to resolve third-party type issues.

Use strict type-aware ESLint rules to supplement compiler checks.

## 5.1 TS Reset

Install:

`@total-typescript/ts-reset`

Follow the current official installation and configuration instructions.

Add a dedicated declaration file, such as:

`src/reset.d.ts`

```ts
import '@total-typescript/ts-reset';
```

Ensure the declaration is included in the TypeScript program.

Use TS Reset to improve the typing of built-in JavaScript APIs.

In particular:

- Treat parsed JSON as untrusted.
- Treat HTTP JSON responses as untrusted.
- Benefit from improved collection type inference.
- Avoid unsafe casts around unknown external data.

Validate untrusted values using Zod or explicit type guards.

Apply this to:

- Redmine responses.
- Webhooks.
- JSON payloads.
- Persisted scheduled-job payloads.
- User-controlled structured input.

Do not assume TS Reset performs runtime validation.

Avoid applying TS Reset unnecessarily to separately published library type declarations.

---

## 6. ESLint requirements

Use the following Gist as the authoritative ESLint baseline:

[https://gist.github.com/topsinoty/f831fd7cb44430c0a5875991839043e0](https://gist.github.com/topsinoty/f831fd7cb44430c0a5875991839043e0)

**Retrieve and inspect the entire Gist before modifying ESLint configuration.**

Preserve its existing rules, strictness, and conventions.

Do not substitute a generic ESLint configuration.

The baseline uses or is intended to use:

- `@eslint/js`.
- `typescript-eslint`.
- `eslint-plugin-sonarjs`.
- `eslint-plugin-unicorn`.
- `eslint-config-prettier`.
- `globals`.
- ESLint flat configuration.
- Type-aware linting.
- Strict TypeScript rules.
- Stylistic TypeScript rules.
- Complexity rules.
- Promise-safety rules.

Preserve existing custom rule settings unless they are invalid, deprecated, conflicting, or demonstrably unsuitable.

## 6.1 Extend ESLint for the project

Extend the baseline for a Node.js TypeScript Discord application.

Evaluate the usefulness of:

- `eslint-plugin-n`.
- `eslint-plugin-import-x`.
- `eslint-plugin-security`.

Only install additional plugins when they provide meaningful value beyond existing rules.

Enforce:

- Correct asynchronous behavior.
- No floating promises.
- No misused promises.
- Consistent type imports.
- Safe TypeScript usage.
- Consistent module imports.
- Avoidance of circular dependencies.
- No unnecessary imports.
- No unresolved imports.
- Appropriate Node.js API usage.
- Reasonable complexity boundaries.
- Safe handling of external input.
- Clear module boundaries.

Avoid overlapping rules that report the same issue.

Do not disable strict rule sets to accommodate poorly structured code.

Use narrow overrides where appropriate.

### 6.2 Configuration conventions

- Use ESLint flat config.
- Prefer `defineConfig` from `eslint/config`.
- Use `projectService` for type-aware linting.
- Configure the TypeScript project root correctly.
- Keep `eslint-config-prettier` last.
- Use Node.js globals for application source.
- Do not enable browser globals in Node.js modules.
- Configure tests and scripts separately where necessary.
- Exclude generated output.
- Preserve existing complexity rules where practical.
- Verify every configured rule exists in its installed plugin version.

### 6.3 Architectural linting

Enforce module boundaries where practical.

Rules:

1. Core modules must not import concrete feature implementations.
2. Features must not import the application entry point.
3. Features must not import another feature's private implementation files.
4. Cross-feature dependencies should use public feature contracts.
5. Database repositories must not depend on Discord interaction objects.
6. Business services should not import command handlers.
7. External API clients should not depend on Discord transport code.
8. Avoid circular imports.
9. Do not import private internals of unrelated features.

Use simple import restrictions or focused architectural tests.

Do not introduce an elaborate architecture framework.

---

## 7. Prettier configuration

Use the following configuration **exactly as provided**.

Create or update `.prettierrc.json`:

```json
{
  "singleQuote": true,
  "semi": true,
  "printWidth": 80,
  "tabWidth": 2,
  "useTabs": false,
  "trailingComma": "all",
  "bracketSpacing": true,
  "bracketSameLine": false,
  "arrowParens": "always",
  "objectWrap": "preserve",
  "endOfLine": "lf",
  "overrides": [
    {
      "files": ["*.scss", "*.sass"],
      "options": {
        "useTabs": true
      }
    }
  ]
}
```

Do not modify these values.

Use a Prettier version supporting `objectWrap`.

Preserve the SCSS/Sass override even if the bot does not currently include stylesheets.

Formatting requirements:

- Prettier handles formatting.
- ESLint handles correctness and code quality.
- Avoid formatting-rule conflicts.
- Use `eslint-config-prettier`.
- Do not add `eslint-plugin-prettier` without a concrete reason.
- Add `.prettierignore`.
- Ignore dependencies, generated output, coverage, and build artifacts.
- Provide `format` and `format:check` scripts.

---

## 8. Target architecture

Create a feature-oriented architecture.

Suggested structure:

```text
lapbot/
├── src/
│   ├── index.ts
│   ├── app.ts
│   ├── core/
│   │   ├── discord/
│   │   │   ├── client.ts
│   │   │   ├── router.ts
│   │   │   └── registration.ts
│   │   ├── permissions/
│   │   ├── scheduler/
│   │   └── config/
│   ├── features/
│   │   ├── roles/
│   │   ├── events/
│   │   ├── reminders/
│   │   ├── birthdays/
│   │   ├── announcements/
│   │   ├── polls/
│   │   ├── movies/
│   │   └── redmine/
│   ├── integrations/
│   │   └── redmine/
│   ├── db/
│   │   ├── client.ts
│   │   ├── schema/
│   │   └── migrations/
│   ├── shared/
│   └── reset.d.ts
├── scripts/
│   └── register-commands.ts
├── tests/
├── eslint.config.ts
├── .prettierrc.json
├── .prettierignore
├── tsconfig.json
├── package.json
├── Dockerfile
├── compose.yaml
└── README.md
```

This is a suggested logical structure.

Do not create empty directories or placeholder modules merely to match it.

Prefer colocating feature-specific implementation and tests.

## 8.1 Core responsibilities

Core owns:

- Discord client lifecycle.
- Command registration.
- Interaction routing.
- Feature registration.
- Centralized authorization.
- Persistent scheduling.
- Configuration.
- Logging and error boundaries.
- Graceful shutdown.

Core must not contain feature-specific business logic.

## 8.2 Feature responsibilities

Each feature owns:

- Slash commands.
- Component interactions.
- Discord event handlers.
- Business logic.
- Validation.
- Feature-specific persistence.
- Scheduled job handlers, when required.
- Public services used by other features.

## 8.3 Integration responsibilities

External integrations own:

- HTTP communication.
- Authentication.
- External response validation.
- Retry and timeout behavior.
- External API error normalization.

Redmine-specific HTTP logic must not be scattered throughout Discord command handlers.

---

## 9. Extensible feature registration

Extensibility is a primary architectural requirement.

Implement a lightweight, type-safe feature registration system.

A feature may provide any combination of:

- Slash commands.
- Button handlers.
- Select-menu handlers.
- Modal handlers.
- Discord event listeners.
- Scheduled job handlers.

Do not require features to implement capabilities they do not use.

## Requirements

1. Register features explicitly in a composition root.
2. The central router must not contain feature-specific switch statements.
3. New commands should be registered through feature declarations.
4. New components should not require changes to unrelated features.
5. New scheduled jobs should be added through feature registration.
6. Duplicate handler identifiers must be detected.
7. Dependencies must remain explicit.
8. Features must be independently testable.
9. A feature can be disabled without breaking unrelated functionality.
10. Persistent components must continue working after restarts.

Prefer static registration over runtime filesystem scanning.

Do not build a generic plugin installation system.

## 9.1 Component identifiers

Use stable, namespaced custom IDs.

Examples:

```text
roles:select:<panel-id>
events:rsvp:<event-id>:going
polls:vote:<poll-id>
```

Respect Discord's custom ID limits.

Do not place credentials or sensitive information in component IDs.

Validate identifiers before using them.

Persist state needed for long-lived interactions.

Do not rely on in-memory interaction collectors for components expected to remain usable after restarts.

## 9.2 Cross-feature composition

Features may use other features through explicit public services.

Examples:

- Movies use polls for voting.
- Movies use events for movie-night scheduling.
- Events use the scheduler for reminders.
- Birthdays use the scheduler for announcements.
- Redmine can use reminders for issue deadlines.

Avoid duplicating existing business logic.

Do not build a generic event bus unless a real requirement emerges.

---

## 10. Centralized role-based access control

Implement RBAC as a core service.

The permission system must distinguish between:

- Public actions.
- Member actions.
- Organizer actions.
- Administrative actions.
- External-system actions.

Permissions should be action-based.

Example identifiers:

```text
event:create
event:manage
role:create
role:manage
role:assign
reminder:channel
announcement:create
announcement:publish
announcement:schedule
poll:create
poll:manage
movie:manage
redmine:issue:create
redmine:issue:update
redmine:issue:assign
redmine:subscription:manage
permissions:manage
```

## 10.1 Authorization requirements

- Map Discord role IDs to application permissions.
- Store permission grants in PostgreSQL.
- Scope mappings by guild ID.
- Support members having multiple roles.
- Combine permission grants from all member roles.
- Default-deny restricted actions.
- Support public commands without requiring role grants.
- Define an explicit administrator override policy.
- Support ownership checks for user-created resources.
- Recheck permissions on component interactions.
- Enforce authorization before privileged side effects.
- Respect Discord's native permissions.
- Respect Discord's role hierarchy.

Do not rely on command visibility alone for authorization.

## 10.2 Permission commands

Implement:

```text
/permissions grant
/permissions revoke
/permissions list
/permissions check
```

Permission management must itself be restricted.

Provide a safe bootstrap mechanism for initial administrator access, such as a Discord `Administrator` permission override for permission-management operations.

Prevent privilege escalation.

Permission changes should be logged.

Do not expose sensitive configuration through public responses.

## 10.3 Authorization API

Provide a simple shared authorization contract.

Feature implementations should not need to know how permission grants are stored.

Avoid repeating role-checking code throughout features.

Where appropriate, attach permission requirements to command or component registrations.

However, authorization must also be enforceable directly from business services when actions can be invoked outside their original Discord handler.

---

## 11. Role management

Extend the current implementation.

Commands:

```text
/role create
/role delete
/role assign
/role remove
/role list
/role panel create
/role panel update
/role panel remove
```

### Role management requirements

- Preserve existing role-selection functionality during migration.
- Support configurable self-assignable roles.
- Support modern select-menu role panels.
- Allow members to select multiple eligible roles.
- Support multiple panels.
- Persist panel configuration and Discord message IDs.
- Avoid duplicate panel messages.
- Validate role existence and manageability.
- Prevent self-assignment of administrative roles.
- Handle deleted Discord resources.
- Respect role hierarchy.
- Restrict administrative actions through RBAC.

Do not automatically remove legacy reaction panels.

Provide an explicit migration command or documented administrative procedure.

---

## 12. Event management

Commands:

```text
/event create
/event edit
/event cancel
/event list
/event view
/event attendees
```

## Event properties

- Title.
- Description.
- Start date and time.
- Optional end date and time.
- Timezone.
- Location or online link.
- Organizer.
- Announcement channel.
- Optional participant limit.
- Optional role mentions.
- RSVP status.
- Optional reminders.
- Event status.

### Event properties requirements

- Only authorized organizers can create and manage events.
- Publish formatted Discord messages.
- Support Going, Maybe, and Not Going.
- Support changing RSVPs.
- Prevent duplicate registrations.
- Enforce participant limits atomically.
- Persist events and RSVPs.
- Support editing and cancellation.
- Update associated messages when possible.
- Automatically schedule configured reminders.
- Handle deleted messages and channels.
- Support native Discord Scheduled Events where appropriate.

Do not create multiple conflicting sources of truth.

Custom RSVP and reminder state should have a clearly defined owner.

---

## 13. Reminders

Commands:

```text
/remindme
/reminders list
/reminders edit
/reminders cancel
```

Support:

- Relative reminders.
- Absolute reminders.
- Personal reminders.
- Channel reminders.
- Recurring reminders.

## Reminders requirements

- Personal reminders are accessible to ordinary members.
- Channel reminders require elevated permissions.
- Persist reminders in PostgreSQL.
- Survive restarts.
- Support cancellation.
- Support editing.
- Validate future dates.
- Use IANA timezones.
- Handle unavailable DMs.
- Handle deleted channels.
- Prevent uncontrolled duplicate delivery.
- Apply reasonable quantity and frequency limits.
- Retry transient failures.
- Do not retry permanent failures indefinitely.

Use the shared scheduler.

Do not use long-running `setTimeout()` calls as durable storage.

---

## 14. Birthdays

Commands:

```text
/birthday set
/birthday remove
/birthday view
/birthday upcoming
/birthday settings
```

### Birthdays requirements

- Members voluntarily register birthdays.
- Store month and day.
- Do not require birth year.
- Support visibility preferences.
- Support removing personal birthday data.
- Support configurable announcement channels.
- Automatically publish birthday wishes.
- Optionally assign a temporary birthday role.
- Reliably remove temporary roles.
- Prevent duplicate announcements.
- Handle leap-day birthdays explicitly.
- Use the guild timezone for announcement scheduling.

Privacy must be considered part of the feature design.

Do not expose birthday data contrary to member preferences.

---

## 15. Announcements

Commands:

```text
/announce create
/announce preview
/announce publish
/announce schedule
/announce edit
/announce cancel
```

### Announcements requirements

- Authorized members can create announcements.
- Support plain text and embeds.
- Support title, content, and optional formatting.
- Allow destination channel selection.
- Provide private previews.
- Support immediate and scheduled publishing.
- Persist scheduled announcements.
- Support editing and cancellation.
- Support controlled role mentions.
- Prevent accidental mass mentions.
- Record publication results.
- Handle failed deliveries.

Use Discord's `allowedMentions` controls.

Do not allow arbitrary users to mention privileged groups or everyone.

---

## 16. Polls

Commands:

```text
/poll create
/poll list
/poll results
/poll close
/poll cancel
```

### Polls requirements

- Single-choice voting.
- Multiple-choice voting.
- Configurable deadlines.
- Interactive voting.
- Persistent votes.
- Vote changes while open.
- Optional anonymous voting.
- Optional result visibility.
- Automatic closure.
- Tie handling.
- Authorization for management.
- Transactionally correct concurrent voting.
- Reliable state after restarts.

Store vote state in PostgreSQL.

Do not expose voter identities in public results when anonymity is enabled.

Document any limitations of anonymity for administrators with database access.

The polling feature must be reusable by other features.

Use native Discord polls for simple cases only when their behavior meets the actual requirements. Custom application polls are required where persistent cross-feature integration or advanced voting behavior is necessary.

---

## 17. Movie management

Commands:

```text
/movie suggest
/movie suggestions
/movie remove
/movie vote
/movie history
/movie watched
/movie night
```

## Movie management requirements

### Suggestions

- Allow members to suggest movies.
- Track the suggesting member.
- Store the title and optional metadata.
- Avoid duplicates where practical.
- Allow authorized removal.

### Voting

- Reuse the generic polling feature.
- Generate polls from movie suggestions.
- Support voting deadlines.
- Handle ties explicitly.
- Track the selected movie.

### Movie nights

- Reuse the events feature.
- Allow organizers to schedule screenings.
- Support RSVPs.
- Support reminders.
- Publish movie-night announcements.

### Viewing history

- Record watched movies.
- Track screening dates.
- Show historical movie nights.
- Identify previously watched movies.

Keep external movie metadata providers optional.

Do not introduce a separate voting, scheduling, or event engine for movies.

---

## 18. Redmine integration

Redmine must be implemented as an independent integration feature.

The bot should provide access to Redmine functionality from Discord while respecting Redmine authorization.

Redmine remains the source of truth for its project and issue data.

Commands:

```text
/redmine projects
/redmine issues
/redmine issue view
/redmine issue create
/redmine issue update
/redmine issue assign
/redmine issue comment
/redmine link
/redmine unlink
/redmine subscribe
/redmine unsubscribe
```

## 18.1 Redmine API client

Implement a typed HTTP client that supports:

- Configurable base URL.
- Authentication.
- Project retrieval.
- Issue retrieval.
- Issue creation.
- Issue updates.
- Assignments.
- Comments.
- Pagination.
- Request timeouts.
- Error handling.
- Response validation.

Use native `fetch` where practical.

Validate external responses.

Do not scatter HTTP requests throughout command handlers.

## 18.2 Account linking

Support linking Discord identities with Redmine identities.

Requirements:

- Safe credential handling.
- Credential revocation.
- Identity mapping.
- No credentials in public Discord messages.
- No credentials in logs.
- Encryption at rest for stored API credentials.
- Encryption keys managed outside the database.

Verify the authentication mechanisms supported by the actual Redmine deployment before implementation.

Do not assume OAuth support or a particular Redmine version.

## 18.3 Authorization

Discord authorization and Redmine authorization must both be respected.

A member having `redmine:issue:view` or another bot permission must not automatically grant them access to private Redmine resources.

For user-specific operations, use the linked user's supported Redmine credentials where feasible.

Use restricted service accounts only for explicitly shared operations.

## 18.4 Notifications

Support notifications for:

- New issues.
- Issue assignments.
- Issue status changes.
- Comments.
- Upcoming deadlines.

Allow authorized administrators to subscribe channels to relevant projects.

Prevent duplicate notifications.

Prefer supported Redmine webhooks where available.

Otherwise, use bounded incremental polling with persistent checkpoints.

Do not implement continuous full-project synchronization.

Verify that notification content is permitted in its destination Discord channel.

## 18.5 Cross-feature integration

Allow users with appropriate permissions to create reminders for Redmine deadlines.

Reuse the shared reminder and scheduler infrastructure.

Do not duplicate Redmine data unnecessarily.

---

## 19. Persistent scheduling system

Implement one shared, persistent job scheduler.

Used by:

- Reminders.
- Birthdays.
- Birthday role removal.
- Announcements.
- Event reminders.
- Poll closure.
- Redmine deadline notifications.

### Persistent scheduling system requirements

Jobs must support:

- Unique identifiers.
- Job type.
- Validated payload.
- Scheduled execution time.
- Status.
- Attempt count.
- Retry configuration.
- Failure information.
- Cancellation.
- Recurrence, when required.
- Execution timestamps.
- Optional idempotency keys.

Persist jobs in PostgreSQL.

Use safe database-backed claiming to prevent multiple workers from intentionally executing the same claimed job concurrently.

A transaction with row-level locking or an equivalent safe claiming mechanism is appropriate.

Use bounded batch sizes and controlled polling intervals.

Recover jobs after restarts.

Handle overdue jobs according to their semantics.

For example:

- A personal reminder may still be delivered late.
- An expired poll should be closed.
- An outdated announcement may require skipping rather than publishing.

Do not treat every overdue job identically.

Design for at-least-once execution and idempotent handlers.

Do not claim exactly-once Discord message delivery.

Initially run the scheduler within the same application process.

Avoid introducing Redis, BullMQ, RabbitMQ, or a separate worker service without a real requirement.

---

## 20. Database design

Use PostgreSQL and Drizzle ORM.

Use migrations for schema changes.

Model the necessary persistent concepts, including:

- Guild configuration.
- Role permissions.
- Role panels.
- Events.
- RSVPs.
- Reminders.
- Birthdays.
- Announcements.
- Polls.
- Poll options.
- Poll votes.
- Movie suggestions.
- Movie viewing history.
- Scheduled jobs.
- Redmine account links.
- Redmine subscriptions.
- Redmine synchronization checkpoints.

These are conceptual entities, not a strict one-table-per-item requirement.

## Database requirements

- Explicit primary keys.
- Appropriate foreign keys.
- Appropriate unique constraints.
- Relevant indexes.
- Transactional consistency.
- Parameterized queries.
- Bounded queries.
- No unnecessary data duplication.
- No unnecessary ORM abstractions.
- No N+1 queries where avoidable.

Use transactions for operations with concurrency requirements.

Examples:

- Enforcing event capacity.
- Changing a poll vote.
- Claiming scheduled jobs.
- Recording unique delivery attempts.

Do not create interfaces that merely mirror Drizzle operations without adding a meaningful boundary.

Prefer small, feature-specific persistence modules.

## Multi-guild readiness

The bot initially serves Lapikud.

However:

- Scope server configuration by guild ID.
- Scope RBAC mappings by guild ID.
- Scope community data appropriately.
- Do not hardcode business logic to a single guild.

Do not implement elaborate multi-tenant management before it is needed.

---

## 21. Configuration

Validate environment variables using Zod.

Maintain backwards compatibility with existing configuration where feasible.

Provide `.env.example`.

Expected configuration includes:

```dotenv
DISCORD_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_GUILD_ID=

DATABASE_URL=

LOG_LEVEL=info
DEFAULT_TIMEZONE=Europe/Tallinn

ROLE_SELECTION_CHANNEL_ID=
TARKVARA_ROLE_ID=
HELPDESK_ROLE_ID=
KULTUUR_ROLE_ID=

WELCOME_CHANNEL_ID=

REDMINE_BASE_URL=
REDMINE_API_KEY=
CREDENTIAL_ENCRYPTION_KEY=
```

Not all variables should be mandatory.

Feature-specific configuration should only be required when that feature is enabled and needs it.

Avoid forcing Redmine credentials into development environments that do not use Redmine.

Do not commit real credentials.

Store guild configuration persistently where runtime changes are appropriate.

Avoid configuration duplication between environment variables and database settings.

Document precedence rules explicitly.

---

## 22. Discord interaction handling

Use modern discord.js interactions.

Support:

- Slash commands.
- Buttons.
- Select menus.
- Modals.
- Autocomplete where useful.
- Ephemeral responses.
- Deferred responses.

## Discord interaction handling requirements

- Respect Discord interaction acknowledgement deadlines.
- Do not acknowledge the same interaction twice.
- Use deferred replies for potentially slow operations.
- Recheck authorization for persistent components.
- Handle invalid or expired component state.
- Validate user input.
- Handle deleted or inaccessible Discord objects.
- Avoid unnecessary Discord API requests.
- Request only necessary Gateway Intents.
- Avoid Message Content intent unless a concrete feature requires it.
- Do not fetch all guild members unnecessarily.

Prefer application commands and interactions over parsing message content.

Keep user-facing errors concise and actionable.

Use stable command names.

Structure user-facing text so Estonian localization can be introduced later without rewriting business logic.

Do not introduce a large internationalization framework prematurely.

---

## 23. Error handling and observability

Use centralized error boundaries.

Cover:

- Discord commands.
- Button handlers.
- Select-menu handlers.
- Modal handlers.
- Discord event listeners.
- Scheduled jobs.
- Database operations.
- Redmine API operations.

Use Pino for structured logging.

Include relevant context:

- Feature.
- Command.
- Guild ID.
- User ID.
- Operation ID.
- Job ID.
- Error type.

Do not log secrets or sensitive payloads.

Use appropriate log levels.

Distinguish expected operational failures from programming errors.

Do not swallow unexpected exceptions.

Support graceful shutdown:

- Stop accepting new work.
- Stop scheduling new jobs.
- Release database connections.
- Shut down the Discord client.
- Handle termination signals.

Use minimal health reporting where useful for deployment.

Do not add a web server solely for a health endpoint unless the deployment actually benefits from one.

---

## 24. Security requirements

Security must be enforced at the appropriate boundaries.

Implement:

- Centralized RBAC.
- Discord role hierarchy checks.
- External authorization checks.
- Runtime validation.
- Safe database queries.
- Credential protection.
- Safe mention handling.
- Appropriate command restrictions.
- Rate limiting or abuse prevention where needed.
- Appropriate user-data retention.
- Safe logging.
- Minimal Gateway Intents.

Do not expose Redmine credentials.

Do not allow Discord commands to circumvent Redmine access restrictions.

Do not assume a button is safe merely because it was created by the bot.

Validate every interaction against current application state.

For webhook endpoints, verify authenticity using a mechanism supported by the deployed service, such as an authenticated secret.

Never accept unauthenticated external requests that can directly trigger privileged Discord actions.

---

## 25. Performance and efficiency

Prioritize actual performance requirements.

Review:

- Data structures.
- Algorithms.
- Database access patterns.
- Discord API usage.
- Scheduling.
- External HTTP requests.
- Memory consumption.
- Startup behavior.

Requirements:

- Avoid repeated queries during one operation.
- Avoid unnecessary API calls.
- Use pagination.
- Avoid unbounded memory collections.
- Batch scheduler operations.
- Bound job concurrency.
- Use appropriate indexes.
- Avoid blocking the Node.js event loop.
- Handle external request timeouts.
- Respect Discord rate limits.
- Avoid unnecessary database transactions.
- Do not introduce caching without a demonstrated need.

When optimizing, identify the bottleneck being addressed.

Do not sacrifice maintainability for speculative performance improvements.

---

## 26. Testing strategy

Use Vitest.

Start by adding tests around existing behavior where feasible.

Test architectural and functional contracts.

## Core tests

- Feature registration.
- Duplicate registration detection.
- Command routing.
- Component routing.
- Permission enforcement.
- Error handling.
- Scheduled job registration.

## Role tests

- Existing role mappings.
- Reaction add/remove behavior.
- Unrelated message rejection.
- Missing roles.
- Self-assignable restrictions.
- Role hierarchy.

## Permission tests

- Public actions.
- Granted permissions.
- Multiple-role union.
- Revocation.
- Administrator behavior.
- Guild isolation.
- Unauthorized interaction submissions.

## Event tests

- RSVP creation.
- RSVP changes.
- Duplicate prevention.
- Capacity enforcement.
- Concurrent registrations.
- Cancellation.

## Reminder and scheduler tests

- Relative times.
- Absolute times.
- Recurrence.
- Cancellation.
- Restart recovery.
- Overdue jobs.
- Retry behavior.
- Duplicate execution prevention.

## Birthday tests

- Date validation.
- Leap-day handling.
- Visibility preferences.
- Duplicate announcement prevention.

## Poll tests

- Single-choice votes.
- Multiple-choice votes.
- Vote replacement.
- Invalid options.
- Poll closing.
- Ties.
- Concurrent voting.

## Movie tests

- Duplicate suggestions.
- Poll integration.
- Event integration.
- Viewing history.

## Redmine tests

- Response validation.
- Authentication errors.
- Authorization.
- Timeouts.
- Invalid issue data.
- Notification deduplication.
- Incremental synchronization.

Use mocks for Discord and external HTTP boundaries.

Use real PostgreSQL integration tests for transactional behavior.

Do not mock the behavior under test.

Do not pursue arbitrary coverage numbers at the expense of meaningful tests.

---

## 27. Deployment

Inspect the existing repository's deployment system first.

Preserve and improve it where possible.

If appropriate, provide a multi-stage Dockerfile and Docker Compose configuration.

Expected services:

- Discord application.
- PostgreSQL.

Requirements:

- Persistent database storage.
- Proper restart policies.
- Graceful shutdown.
- Environment-based configuration.
- Production logging.
- Migration procedure.
- Minimal runtime dependencies.
- Non-root container execution where practical.
- No public PostgreSQL port by default.

Do not introduce unnecessary services.

Use an HTTP endpoint only when needed for integrations such as authenticated Redmine webhooks.

Do not expose internal services publicly without justification.

---

## 28. Development experience

Provide or update:

- `README.md`.
- `.env.example`.
- `package.json`.
- `tsconfig.json`.
- `eslint.config.ts`.
- `.prettierrc.json`.
- `.prettierignore`.
- Drizzle configuration.
- Database migrations.
- Vitest configuration.
- Dockerfile.
- Docker Compose configuration.
- Command registration script.

Provide scripts equivalent to:

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier . --write",
    "format:check": "prettier . --check",
    "test": "vitest run"
  }
}
```

These are examples. Adapt them to the actual project configuration.

Provide additional commands for:

- Database generation.
- Database migration.
- Discord command registration.

Do not create unnecessary command wrappers.

## Documentation

Document:

1. Local setup.
2. Discord application creation.
3. Required OAuth2 scopes.
4. Required Discord permissions.
5. Required Gateway Intents.
6. Environment configuration.
7. PostgreSQL setup.
8. Running migrations.
9. Registering commands.
10. Local development.
11. Production deployment.
12. Administrator permission setup.
13. Redmine integration.
14. Role-panel migration.
15. Adding new features.

---

## 29. Implementation sequence

Work incrementally.

Keep the application functional between phases.

## Phase 1: Audit and stabilization

- Inspect the repository.
- Inspect the provided ESLint baseline.
- Review existing JavaScript.
- Identify bugs.
- Establish baseline tests.
- Fix reaction handling.
- Validate existing configuration.
- Preserve working behavior.

## Phase 2: TypeScript and code quality

- Introduce TypeScript.
- Configure strict compiler settings.
- Install TS Reset.
- Adapt the provided ESLint baseline.
- Extend ESLint for Node.js and architectural boundaries.
- Apply the exact Prettier configuration.
- Migrate existing JavaScript incrementally.
- Verify type checking and linting.

## Phase 3: Modular architecture

- Create the application composition root.
- Implement feature registration.
- Implement command routing.
- Implement component routing.
- Support feature-specific Discord event listeners.
- Establish error handling.
- Move existing role management into the roles feature.
- Verify that the existing bot still functions.

## Phase 4: Shared infrastructure

- Introduce PostgreSQL.
- Configure Drizzle.
- Create initial migrations.
- Implement centralized RBAC.
- Implement persistent scheduling.
- Add guild configuration.
- Test persistence and authorization.

## Phase 5: Community features

Implement in this order:

1. Improved role management.
2. Reminders.
3. Announcements.
4. Events and RSVPs.
5. Birthdays.
6. Polls.
7. Movie suggestions and movie nights.

Reuse shared infrastructure.

Do not duplicate scheduling, authorization, or voting functionality.

## Phase 6: Redmine integration

- Inspect supported Redmine API capabilities.
- Implement the typed client.
- Implement read-only commands.
- Implement account linking.
- Implement authorized issue mutations.
- Implement subscriptions and notifications.
- Integrate deadline reminders.

## Phase 7: Hardening

- Run TypeScript checks.
- Run ESLint.
- Run Prettier checks.
- Run tests.
- Validate migrations.
- Review permissions.
- Review concurrency.
- Review error handling.
- Review external API resilience.
- Review performance.
- Review deployment.
- Update documentation.

Fix actual problems identified by these reviews.

---

## 30. Verification commands

Use the repository's configured scripts.

Expected checks include:

```bash
pnpm install
pnpm exec tsc --noEmit
pnpm exec eslint .
pnpm exec prettier . --check
pnpm test
pnpm build
```

Adapt commands if required by the existing package manager and project configuration.

Also verify:

- Commands register successfully.
- Existing role selection still works.
- Database migrations work.
- Features initialize successfully.
- Scheduled jobs survive restarts.
- Authorization denies unauthorized operations.
- Persistent buttons and menus remain usable after restarts.
- Redmine failures do not crash the application.
- Production builds can start without development tooling.

Do not claim successful checks that were not executed.

---

## 31. Definition of done

The implementation is complete when:

- The existing repository has been evolved rather than replaced.
- Existing role-selection functionality is preserved or safely migrated.
- TypeScript strict mode is enabled.
- TS Reset is configured.
- The provided ESLint Gist is used as the baseline.
- ESLint is extended appropriately for the project.
- The exact supplied Prettier configuration is used.
- The application has a feature-oriented modular architecture.
- New features can be registered without modifying the core dispatcher.
- All requested features are functional.
- Restricted actions enforce RBAC.
- State persists across restarts.
- Scheduled jobs recover safely.
- Movies reuse polls and events.
- Redmine integrates without bypassing external authorization.
- The application has meaningful automated tests.
- Builds and type checks pass.
- Linting and formatting checks pass.
- Deployment is documented.
- Configuration is validated.
- No placeholder implementations are presented as completed functionality.
- No unnecessary abstractions or dependencies remain.

---

## 32. Final engineering review

After implementation, review the changes critically.

Evaluate:

## Architecture

- Can another feature be added independently?
- Are feature boundaries clear?
- Are dependencies explicit?
- Does the core know too much about individual features?
- Are there circular dependencies?
- Are abstractions justified?

## Correctness

- Are permissions enforced consistently?
- Are concurrency-sensitive operations atomic?
- Are scheduled jobs recoverable?
- Do long-lived Discord interactions work after restarts?
- Are external API failures handled?

## Performance

- Are there unnecessary database queries?
- Are API calls minimized?
- Are scheduler operations bounded?
- Are memory collections bounded?
- Are data structures appropriate?

## Maintainability

- Is code readable?
- Are functions cohesive?
- Are types precise?
- Is configuration clear?
- Are dependencies justified?
- Is any functionality duplicated?

## Simplicity

- Can unnecessary layers be removed?
- Can interfaces be simplified?
- Is there speculative infrastructure?
- Does the architecture solve current requirements rather than hypothetical future problems?

Refactor where appropriate without changing intended behavior.

Do not introduce complexity merely to make the code appear sophisticated.

---

## 33. Expected final response

After implementation, provide:

1. Summary of the original repository.
2. Changes made to the existing code.
3. Architecture overview.
4. Implemented features.
5. Functionality preserved.
6. New dependencies and their justification.
7. Database schema and migration summary.
8. Development commands.
9. Deployment instructions.
10. Test, lint, type-check, and build results.
11. Known limitations.
12. Required external configuration.
13. Instructions for implementing another feature.

If anything remains incomplete, identify it explicitly.

Do not present unimplemented functionality as complete.

---

## Final instruction

**Begin by inspecting `lapikud/lapbot` and the supplied ESLint Gist.**

Understand the existing code before changing it.

Preserve the existing reaction-based role-selection system while safely migrating toward a modular, TypeScript-based Discord application.

Apply the exact Prettier configuration and configure TS Reset.

Build extensibility into the application's composition and feature contracts, not through unnecessary frameworks.

Implement the requested features incrementally, using shared authorization, scheduling, and persistence infrastructure.

Keep the application functional throughout the migration.

Prioritize correct behavior, strong typing, security, maintainability, and performance.

**Build a system that can grow deliberately without accumulating unnecessary architectural complexity.
