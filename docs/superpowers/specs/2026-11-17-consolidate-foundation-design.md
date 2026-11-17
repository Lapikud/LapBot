# Foundation consolidation specification

Status: implemented and verified; see [verification record](../plans/consolidate-foundation-verification.md).
Branch: `fix/consolidate-foundation`.

## 1. Outcome and constraints

Make existing features compositions of small parts with explicit inputs,
outputs, state ownership, and reasons to change. Each part does one thing
well. Reuse before creating; composition before inheritance. A responsibility
does not automatically require a service, class, table, or interface.

Retain Hono, server-rendered JSX, native HTML forms, Pico, existing persistence,
scheduler, providers, and dependencies. Preserve commands, URLs, permissions,
record IDs, field names/values, message output, and queued job compatibility.
Preserve existing delivery ordering, claims, recovery, and failure behavior.
Any discovered behavior change must be identified and reviewed separately.

This scope includes shared input semantics, UI composition, managed posts,
pure message presentation, and calendar boundary extraction. It excludes custom
forms/form builders, configurable schemas, universal response persistence,
new providers, multi-calendar support, persisted event/poll-to-post links,
a visual redesign, generic repositories, and workflow/provider frameworks.
No database migration is planned; a concrete need requires a separate reviewed
migration design, backfill verification, and rollback/recovery strategy.

## 2. Responsibility map

| Part                | Owns                                                     |
| ------------------- | -------------------------------------------------------- |
| Form definition     | Fields describing information to collect                 |
| Field definition    | One input's semantic type and supported constraints      |
| Submission          | Values presented against a definition, before acceptance |
| Validation result   | Accepted typed values or structured field issues         |
| UI control          | Native control presentation and accessible associations  |
| Message             | Content and interactive controls                         |
| Post                | Authored content and managed publication lifecycle       |
| Messenger           | Sending, editing, removing messages                      |
| Schedule/job        | When an operation runs / the work performed              |
| Feature             | Purpose-specific rules and composition                   |
| Integration adapter | Translation to one external capability/provider          |

An HTML form is a presentation/transport mechanism, not necessarily a domain
Form. A submission need not be a persisted Response entity. A sent message
need not be a Post. Features do not inherit a universal lifecycle.

Composition in existing features:

- Poll: choice input + voting policy + votes/results + message presentation.
- Birthday registration: fixed input definition + date/privacy rules + record.
- Announcement: Post lifecycle + existing announcement permissions and wording.
- Event: schedule/location/attendance + message projection + optional calendar.
- Movies: suggestions/screenings + catalog lookup + polls/events as needed.
- Issue notifications: subscriptions/checkpoints + tracker lookup + delivery.

## 3. Shared input semantics

### Minimum contract

Place pure definitions and validation under `src/domain/forms/`, with a public
export through the domain module. The minimum responsibilities are:

| Contract           | Required shape/behavior                                                         |
| ------------------ | ------------------------------------------------------------------------------- |
| FormDefinition     | Readonly collection of named field definitions; no lifecycle or stored identity |
| FieldDefinition    | Stable key, label, semantic kind, and constraints for that kind                 |
| Submission         | Own-property map of field keys to submitted values                              |
| FieldIssue         | Field key and a stable issue code; feature adapters choose compatible wording   |
| ValidationResult   | Discriminated success with typed values, or failure with issues                 |
| validateSubmission | Pure definition + submission -> result; no I/O or authorization                 |

Start with integer input and choice input, including multiple choices. Choice
values retain their actual string or number identities; poll option IDs must
not become array positions or labels. Support required presence, integer
bounds, permitted choices, and choice cardinality only where current consumers
need them. Reuse existing validation tools where they satisfy the contract;
do not implement a second general-purpose schema library beside Zod.

Transport adapters decode HTTP/Discord inputs into semantic values. The shared
validator checks those values without HTML, Hono, Discord SDK, database, actor,
or scheduler dependencies. Defaults and coercion are explicit in the feature's
input adapter, not silently introduced by the shared validator.

Preserve these distinctions: absent own property means omitted; an empty
string remains empty; null is an explicit clear only when the caller supports
it; an empty choice array is present and can represent clearing a vote. Do not
trim, coerce, default, deduplicate, or clear all inputs by a universal rule.
The birthday adapter retains its current fallback to public visibility; the
poll adapter retains existing duplicate-choice normalization.

Do not introduce FormService, field registries, dynamic renderers, response
repositories, form availability state, or anonymous-response metadata.
Unknown extra fields are not copied into accepted values; required feature
metadata such as actor/record IDs travels separately.

### First proof: one operation, two consumers

Before migrating services, demonstrate the same permitted-choice validation
with birthday visibility and a poll's selected option IDs. Tests must show
both callers use one implementation with no feature-name switches, preserve
string/numeric identities, and return field-addressable errors. This is a
small retained foundation test, not a new product feature.

If the proof requires feature flags, a generic lifecycle, or unrelated methods,
revise the boundary before continuing. Add integer handling for birthday day
and month only after the choice contract works for both consumers.

### Feature ownership and compatibility

Birthdays supply a fixed definition for day, month, and visibility. The birthday
feature still owns real calendar-date validity, leap-day celebration, privacy,
default visibility, persistence, and recurrence. The shared integer bounds
cannot determine whether February 30 is valid.

Polls compose a choice definition from their options. Polls own eligibility,
open/closed state, single/multiple voting policy, vote changes/clearing,
aggregation, anonymity, result visibility, and ordered options. Cardinality
constraints are supplied from poll policy; the form layer does not decide it.

Existing repositories enforce some rules: birthday date validation runs in
its repository; poll votes check current state, cardinality, and option
membership inside a transaction. Keep transactional checks authoritative.
Shared pure predicates may support both early input feedback and transaction
checks, but do not replace current-state checks with a stale preflight result.
Do not weaken repository invariants or duplicate their rule implementations.

Reuse existing poll and birthday storage. Field errors are translated at
feature boundaries to existing public error messages. Service request types
remain compatible; the new concepts do not force callers into generic maps.

## 4. UI composition

Keep the shell/navigation in `layout.tsx`; put reusable presentation in
`src/infra/web/ui/` with a public export. Adopt it across birthdays, polls,
events, movies, announcements, roles, and permissions where behavior matches.

Extract Field (label/help/error associations), typed native controls, existing
checkbox/multi-select behavior, form actions, and small POST actions. Sections
and empty states earn a shared component only through actual repeated use.
A wrapper must add consistency/accessibility rather than merely rename HTML.

Preserve native attributes, submitted names/values, selection/default state,
and ordering. Use stable control IDs, label associations, `aria-describedby`
for help/errors, and `aria-invalid` for invalid controls. Support caller IDs
where field names repeat. Preserve escaping.

Generic controls do no service/directory lookups, business validation, or
request parsing. Channel/role selectors compose these controls in server-aware
web code. Features may use definition labels/constraints, but do not render
whole forms automatically from domain definitions. Keep specialized cards,
role-editor rows, tables, previews, and layouts local where appropriate.
UI action visibility does not replace service authorization.

## 5. Managed posts and authorization

### Model, operations, and storage

Extract the existing announcement lifecycle into Post: identity, community,
author, title/body, mentions, channel destination, publication state,
scheduled/published time, external message reference, and failure information.
Retain draft/scheduled/published/cancelled states. Post operations own draft
creation, updates, allowed transitions, conditional claims, publication,
cancellation, and delivery outcome recording. Use Messenger directly.

Map a concrete PostRepository to the existing announcements table/enum.
Preserve IDs and avoid a second table, dual writes, or mandatory physical
renames. Retain thin Announcement compatibility exports as needed, without
keeping duplicate lifecycle logic. Existing announcement routes/commands
compose the post API; no UI or Discord adapter implements publication policy.

### Explicit authorization boundary

The first Post API is reusable within this application, not a permission-
configurable framework. Its public user operations accept Actor and enforce
current announcement permission IDs directly through Authorizer. Logical
renaming does not require renaming permissions or inventing policy callbacks.

Preserve the current operation checks:

- Draft creation requires `announcement:create` and validates destination and
  mention permissions before persistence.
- Reading enforces same community and channel visibility. Unpublished content
  is visible to its author or holders of `announcement:publish`.
- Editing/cancelling requires that visibility plus authorship or
  `announcement:publish`, following existing state rules.
- Immediate publication requires `announcement:publish`; scheduling requires
  `announcement:schedule`. Both recheck destination/mention permissions.

Channel access and mention rules use Directory and Actor capabilities as
currently implemented. A renderer cannot authorize publication. Do not expose
an alternative public raw send/transition API that bypasses these checks.

Background jobs have no initiating Actor. They use a private publication
operation, reachable from the registered job handler after checking stored
state and due time. Preserve current execution-time authorization semantics;
do not invent impersonation or silently add new permission rechecks.

A post consumer can use this API without importing announcement commands or
web routes. If a future real consumer needs different permission semantics,
review that requirement then rather than building a policy engine now.

### Scheduling and delivery guarantees

Keep scheduling orchestration separate from immediate publication. It validates
time, updates state, and enqueues through existing Scheduler/defineJob. The job
checks current state/due time, then invokes private publication. Preserve job
names, keys, payloads, cancellation, and the existing one-hour lateness rule.
That rule remains the current post/announcement scheduling behavior, not a
rule for all scheduled work.

Preserve claim-before-send, transient/permanent failure recovery, publication
ordering, and suppression of repeated mentions on edit. A crash after a claim
can lose a delivery; no exactly-once guarantee or new retry policy is added.
Post does not own form responses, event attendance, calendar links, birthday
recurrence, or provider SDK calls.

## 6. Presentation and ordinary delivery

Separate pure post, event, and poll message construction from orchestration.
A renderer accepts data and returns Message; it performs no I/O, authorization,
scheduling, or mutation. Keep public renderer exports compatible where useful.
Preserve text, controls, mentions, timestamps, length checks, and preview
construction. Existing Discord syntax is a documented transport limitation.

Event and poll messages are projections of feature data, not independently
editable duplicate content. Retain their publication reference fields and
Messenger usage. Ordered poll detail sends, missing-message logging, and
role-panel recreation remain explicit consumer policies.

Birthday greetings, reminders, and issue notifications remain ordinary
deliveries using Message/Messenger. Keep feature-specific recurrence, claims,
checkpoints, and failure policies. Do not create Post records to share a send.

## 7. Integration boundaries

Retain capability-specific Messenger, Calendar, MovieCatalog, IssueTracker,
and Directory ports with Discord, TMDB, and Redmine adapters. Reuse existing
Actor, authorization, Clock, Scheduler, and repositories. Do not fragment
Directory or add a Publisher that simply forwards Messenger methods.

Move Calendar/CalendarEvent out of the chat port; isolate Discord calendar
SDK code from the combined adapter file. Make event-to-calendar mapping pure,
including existing default duration/location. The event service decides when
to sync, persists references, and retains warning-and-continue behavior.
The adapter owns SDK payloads/limits; composition chooses implementations.

Keep `native` and `discordEventId` compatible. A future multi-calendar change
needs event/provider/destination links, independent external IDs, durable
opt-in choices, backfills, and independent outcomes. This spec does not claim
those capabilities or add their persistence.

## 8. Delivery sequence and acceptance

Each slice must leave the application runnable and retain the compatibility
requirements in section 1. Tests cover behavior rather than component names.

| Slice                      | Acceptance evidence                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline                   | Record existing static-check/test/build results and relevant regressions before product edits                                                                              |
| Input proof                | Same choice validator handles birthday visibility and poll selections without feature switches                                                                             |
| Input adoption             | Both features compose minimal definitions; error/default/clear semantics and transactional invariants remain equivalent                                                    |
| UI adoption                | Existing requests remain equivalent; accessible associations, native attributes, and escaping are verified                                                                 |
| Posts                      | One lifecycle implementation; actor/visibility/mention checks, transitions, claims, schedule/lateness, edit/cancel, and recovery pass regressions against existing storage |
| Presentation/calendar      | Equivalent render output; pure calendar mapping; adapter create/update/remove and event failure handling verified with fakes                                               |
| Documentation/final review | Actual examples show predefined input, specialized poll input, UI controls, managed posts, ordinary delivery, and an integration adapter                                   |

Reuse existing feature regressions and add focused coverage at new boundaries.
For input, include missing/empty/null/empty-array cases, string and numeric
choices, defaults, duplicate poll selections, and invalid calendar dates.
For posts, include cross-community access, unpublished visibility, non-owner
edits, destination/mention denial, and background publication compatibility.
Test schema resets only against the dedicated disposable test database.

Finish with typecheck, lint including TSX boundary enforcement, formatting,
unit tests, available database/integration tests, and production build. Report
skipped/unexecuted checks explicitly and distinguish baseline failures.
Review for unconsumed abstractions, duplicated rules/lifecycles, and unintended
behavior changes. Stop when the slices above are demonstrated and required
checks pass; persisted post links, custom forms, and additional providers are
not part of the completion claim.

## 9. Approved physical layout follow-up

After implementation, the user approved organizing by ownership within each
architectural boundary. This supersedes the physical locations and temporary
compatibility facades described above; runtime compatibility requirements remain.

Domain capability directories own records, pure rules, and input definitions.
Core capability directories own service, repository ports, message construction,
and mappings. Shared external contracts remain under core/ports. Database
adapters use capability names, including db/posts, independently of SQL names.
Discord messenger and directory adapters have dedicated files; web route
implementations live under web/pages. Internal announcement aliases are removed
once all callers are migrated. Tests and public import boundaries follow the
same ownership. See [layout execution record](../plans/2026-11-17-foundation-layout.md).

## 10. Capability locality refinement

Approved in chat: logical boundaries must support local reasoning. The physical
layer-first structure in section 9 is superseded by the capability-first layout
in `../plans/2026-11-17-local-reasoning.md`. Each feature owns its model, repository
contract, rules, operations, concrete feature adapters and tests. Shared reusable
foundation code and provider/platform integration code remain separate. Direct
imports replace mandatory barrels. Announcement orchestration is explicitly
feature-owned and composes pure Post content; Post itself owns no announcement
permissions, SQL record lifecycle or scheduling. Existing observable behavior and
compatibility requirements remain binding.

### User correction to section 10

Shared primitives live in `src/core/`, not `src/foundation/`. No tests belong in
src. Tests mirror feature ownership under `tests/features/<name>/`, shared
primitives under `tests/core/`, and integrations under `tests/integrations/`.
This explicit user preference supersedes earlier physical names and colocated
test placement; logical boundaries and preservation requirements are unchanged.
