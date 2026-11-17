# Consolidate the foundation

Status: proposed for review; implementation has not started.
Branch: `fix/consolidate-foundation`.

## Intent and success

New features should compose reusable UI controls, application capabilities,
and integration adapters. Existing feature rules remain explicit: birthdays
own recurrence and privacy, events own scheduling and attendance, movies own
suggestions and screenings, and Redmine subscriptions own notification rules.

The user approved consolidation along those three boundaries. This design
assumes existing routes, commands, permissions, data, and delivery behavior
must remain compatible. New providers and a visual redesign are outside scope.

Success means existing features actually use the extracted foundation, a new
form can reuse accessible controls, event and poll publication share a small
post capability, and calendar concerns have a distinct contract and mapping.
Documentation must identify what remains necessary to add a second calendar.

## Approaches considered

1. Incremental extraction from existing consumers (recommended). Establish
   the boundaries with real reuse and preserve each feature's lifecycle.
2. Reorganize files only. Low behavioral risk, but leaves the repeated UI and
   orchestration responsibilities largely intact.
3. Universal form/post/integration framework. More speculative machinery and
   a larger migration; the existing workflows do not support one lifecycle.

## Boundary 1: UI composition

Keep Hono server-rendered JSX, native HTML forms, Pico, and existing CSS.
Separate the page shell from reusable controls currently in `layout.tsx`.
Introduce a small `src/infra/web/ui/` module with an explicit public export.

Provide field composition (label, control, optional help and error), typed
input/textarea/select controls, checkbox and multi-select controls, form
actions, POST action buttons, and empty-state presentation. Control attributes
must preserve native types, required/min/max/maxlength, selected values, and
feature-specific names. Help/error text gets stable associations through
`aria-describedby`; errors set `aria-invalid`. Callers supply stable IDs where
the same field name appears more than once on a page. Use ordinary JSX
children for unusual content; do not introduce a field schema or renderer.

Channel selection composes a generic select but remains server-aware web
code. Generic controls must not import services, authorization, or directory
lookups. Action visibility remains a caller decision; service checks remain
authoritative. Form parsing stays separate from presentation and preserves
the distinction between missing, empty, and explicitly cleared fields.

Migrate repeated fields and actions in birthdays, events, movies, PSAs, polls,
roles, and permissions. Keep feature-specific structures such as movie cards
and role-editor rows local. Auth and logs should reuse controls only where
their behavior matches. Keep tables as native table markup unless inspection
shows a meaningful shared behavior; do not add a configurable table engine.
Keep the existing page shell and navigation behavior.

## Boundary 2: shared application capabilities

`Message`, `Messenger`, `Scheduler`, and `defineJob` are existing foundations.
Extend these narrowly instead of replacing them.

Introduce a post capability under `src/core/` with a public module boundary.
Its reference contains channel and message IDs; its operations publish a
message (or an explicitly ordered sequence) and refresh an existing message.
An ordered publication returns the final post reference for voting controls.
It does not insert feature records, schedule work, claim deliveries, or decide
whether a deleted message should be recreated. Refresh returns the existing
messenger outcome; missing references are handled explicitly by callers.
Exceptions propagate. No automatic retries or compensation are added.

Use it in event and poll publication and refresh, including ordered poll
detail messages. Persist returned references through the existing feature
repositories. Keep each feature's missing-message logging and publication
ordering. Do not rewrite one-shot reminders merely to route every send through
this capability. Announcement claim-before-send behavior remains local; any
adoption there must leave the claim and failure recovery around the send.
Role-panel recreation and reaction reconciliation remain local policies.

Separate pure event and poll message construction from their use-case files
into focused presentation modules in core. The existing `Message` model and
Discord-compatible text are preserved. Public service exports may re-export
existing renderer names to avoid unrelated consumer churn. These presenters
are not advertised as fully provider-neutral: mentions and timestamps still
use Discord syntax. A future alternate chat provider needs its own rendering
work; moving a function alone does not solve that.

Keep scheduling keys, payloads, recurrence rules, authorization, ownership,
visibility, and feature validation unchanged. Do not create a generic CRUD
service, generic repository, workflow engine, or feature registry.

## Boundary 3: integration contracts and adapters

Separate the `Calendar` and `CalendarEvent` contracts from the chat port into
`src/core/ports/calendar.ts`, exported through the existing ports barrel.
Retain the calendar operations and existing opaque IDs. Separate Discord's
calendar implementation from the combined messenger/directory adapter file.
Keep `MovieCatalog`/TMDB and `IssueTracker`/Redmine as distinct capabilities;
they already follow the intended contract-and-adapter pattern.

Extract event-to-calendar mapping and synchronization into a focused core
module. It accepts the calendar contract and an explicit external reference,
maps schedule/location/default duration, and returns the updated reference.
The event service chooses when synchronization is requested, persists the
reference, and retains its current warning-and-continue policy on failure.
The adapter owns Discord payload limits and SDK calls. Composition in
`src/app.ts` chooses concrete providers and optional credentials.

This foundation preserves `native` and `discordEventId` in requests/storage.
They are compatibility constraints, not a multi-provider model. Supporting
multiple calendars for one event requires a follow-up migration with one
external link per event/provider/destination, durable opt-in configuration,
backfilled Discord references, and independent sync outcomes. This design
does not pretend a single injected Calendar can represent simultaneous
destinations. No database migration or additional provider is included here.

## Data flow and failure behavior

Web form -> feature request parser -> authorized feature service -> repository
and shared capabilities -> concrete external adapters.

Discord commands use the same feature services. Presentation produces a
Message; the post capability performs transport operations; feature services
retain persistence and scheduling order. Calendar synchronization is an
explicit side effect of event lifecycle operations.

Preserve announcement claims, Redmine notification claims, birthday daily
claims, job retry classification, missing-message behavior, mention policy,
and cancellation semantics. Partial ordered publication may leave earlier
messages posted, as it does today; no exactly-once guarantee is introduced.

## Verification and rollout

Before edits, run the current static checks and test suite to establish a
baseline. Use the dedicated test PostgreSQL if available; never run the test
schema-reset setup against a development database. Report skipped database
tests explicitly.

Add focused behavioral coverage for accessible control output and escaping,
submitted field compatibility, ordered publication, final references, missing
post refresh, propagated send failures, and calendar mapping/failure behavior.
Use existing event, poll, birthday, movie, announcement, role, permission, and
web regression tests to verify consumers after migration. Exercise calendar
create/update/remove with SDK fakes, without live Discord calls.

Finish with typecheck, lint (including TSX boundary enforcement), format
check, tests, and build. Review the diff for copied validation, unused exports,
and helpers with no real consumer. Update README architecture and adding-a-
feature instructions with concrete examples from migrated features.

Implement in reviewable stages: UI extraction and adoption; post capability
and presentation separation; calendar boundary and synchronization extraction;
documentation and final verification. Each stage must preserve behavior.
Rollback is ordinary code reversion because this scope makes no schema or
configuration migration. Stop when the three boundaries have real consumers
and the checks pass; do not expand into new providers or product features.
