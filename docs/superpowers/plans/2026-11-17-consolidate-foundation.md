# Foundation Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for inline execution, or superpowers:subagent-driven-development if the user selects delegation. Implement task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make existing features compose shared input semantics, accessible UI, managed posts, and focused integration adapters without changing observable behavior.

**Architecture:** Extract from existing implementations, retaining transactional invariants and storage. Input definitions use Zod-backed semantic fields; announcements become a compatibility facade over one post lifecycle. Existing Messenger and Scheduler remain the delivery and scheduling boundaries.

**Tech Stack:** TypeScript, Zod, Hono JSX, Pico, Drizzle/PostgreSQL, discord.js, pg-boss, Vitest, pnpm. No new dependencies.

**Spec:** [Approved specification](../specs/2026-11-17-consolidate-foundation-design.md).

## Global constraints

- Branch: `fix/consolidate-foundation`; do not switch to a new branch or worktree silently.
- Preserve commands, URLs, permissions, record IDs, field names/values, message output, and queued job compatibility.
- Preserve existing delivery ordering, claims, recovery, and failure behavior.
- No database migration is planned; a concrete need requires a separate reviewed migration design, backfill verification, and rollback/recovery strategy.
- No new dependencies, custom forms/form builders, universal response persistence, new providers, persisted event/poll-to-post links, or multi-calendar support.
- Follow existing public barrels and domain/core/infra dependency direction; use native HTML and existing Zod rather than building replacement frameworks.
- Keep repository checks that depend on locked/current state inside their transactions.
- Product changes begin only after plan review and selection of execution method.

## Review focus

1. Duplicate poll option IDs and clearing votes must preserve normalization, cardinality, and current-state transaction checks (Task 3).
2. Missing birthday visibility must keep its public fallback; malformed dates must keep their existing error semantics (Task 3).
3. Scheduled jobs persisted before this branch must still accept `announcements.publish` and `{ announcementId }` (Task 7).
4. Editing a published post must not ping mentions again; failed/concurrent sends retain the current claim behavior (Task 7).
5. Repeated controls on one page must have distinct label/help/error IDs without changing submitted names (Task 4).

## File and interface map

Paths below are relative to the repository root. Consumers use the corresponding public barrel.

- `src/domain/forms/{fields,validation,index}.ts`: semantic definitions, pure validation, public form exports.
- `src/domain/birthday-form.ts`, `src/domain/poll-form.ts`: feature-owned fixed/dynamic definitions and input predicates.
- `src/infra/web/ui/{field,controls,choices,actions,index}.tsx` (barrel is `index.ts`): accessible presentation; `layout.tsx` retains page shell.
- `src/infra/web/selectors.tsx`: server-aware channel choices/select composed from UI controls.
- `src/core/ports/posts.ts`: Post record/repository contract; announcements port becomes compatibility aliases.
- `src/core/services/posts.ts`: sole post lifecycle and registered publication job.
- `src/core/services/announcements.ts`: compatibility names/dependency translation only.
- `src/core/presentation/{posts,events,polls,index}.ts`: pure message constructors, no service imports.
- `src/core/ports/calendar.ts`, `src/core/calendar/{event,index}.ts`: calendar contract and pure event mapping.
- `src/infra/discord/calendar.ts`: provider SDK operations.
- `src/infra/db/announcements/repo.ts`: existing table implements PostRepository; no second implementation.
- `tests/domain/forms.test.ts`, `tests/domain/form-consumers.test.ts`: input contracts and composition.
- `tests/infra/web/ui.test.ts`: rendered JSX checks (keep `.test.ts` so current Vitest glob discovers it).
- `tests/core/services/posts.test.ts`, `tests/core/presentation.test.ts`, `tests/core/calendar.test.ts`, `tests/infra/discord/calendar.test.ts`: focused boundary behavior.

## Task 1: Establish a reproducible baseline

**Files:** Create `docs/superpowers/plans/consolidate-foundation-baseline.md`; read `package.json`, `compose.test.yaml`, `tests/global-setup.ts`, `.env.test` without printing credentials.

**Interfaces:** Consumes current scripts; produces a record of passing/failing/skipped checks and dedicated database availability.

- [x] Record branch, worktree status, Node/pnpm versions, and existing changes. Read applicable ancestor AGENTS.md instructions and execution skills before product changes.
- [x] Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, and `pnpm build`. Record results and any baseline errors; do not silently repair unrelated failures.
- [x] Check Docker availability and the dedicated `postgres-test` service. If usable run `pnpm test:db`, then the integration command with `TEST_DATABASE_URL` explicitly set to the disposable database configured at `127.0.0.1:5433/lapbot_test`; do not inherit an unknown exported database URL. Do not run schema-reset setup against development data.
- [x] Document the exact safe integration invocation without secrets and any environment blocker. Commit only the baseline document with `docs: record consolidation verification baseline`.

## Task 2: Prove minimal shared input semantics

**Files:** Create domain forms files and `tests/domain/forms.test.ts`; modify `src/domain/index.ts`.

**Interfaces:**

- `FieldDefinition<T>`: `{ key: string; label: string; kind: 'integer' | 'choice'; schema: z.ZodType<T> }`.
- `FormDefinition<T extends Record<string, unknown>>`: `{ fields: { [K in keyof T]: FieldDefinition<T[K]> & { key: K } } }`; keys and field keys must agree.
- `FieldIssue`: `{ field: string; code: string }`, with stable Zod issue codes; no feature wording.
- `ValidationResult<T>`: `{ ok: true; values: T } | { ok: false; issues: FieldIssue[] }`.
- `validateSubmission<T extends Record<string, unknown>>(definition: FormDefinition<T>, submission: Readonly<Record<string, unknown>>): ValidationResult<T>`.
- `choiceField<V extends string | number>(options: { key: string; label: string; choices: readonly V[] }): FieldDefinition<V>`.
- `integerField(options: { key: string; label: string; min: number; max: number }): FieldDefinition<number>`.
- Multiple choice uses the existing Zod array/cardinality composition around a choice schema. Do not add a general constraint DSL or registry.

- [x] Write failing tests: `validates string and numeric choices without coercion`, `returns field issues`, `preserves omitted empty null and empty-array semantics`, `does not copy unknown or inherited properties`, `validates integer bounds`. Pin `2` distinct from `'2'`; invalid choices yield `{ ok: false }`; optional omitted fields remain absent while explicit permitted null stays null.
- [x] Run `pnpm exec vitest run tests/domain/forms.test.ts`; expect missing exports to fail.
- [x] Implement the interfaces using Zod field schemas. Own-property reads prevent inherited values from becoming submissions. Omitted required fields fail; optional schemas may accept omission without adding a property. No defaults/coercion/trimming/deduplication are introduced.
- [x] Demonstrate one choice validator with visibility choices `public/announce/private` and numeric poll choices `11/22`, composed into an array for poll submissions. Assert identical implementation path without feature switches.
- [x] Run the focused test plus `pnpm typecheck` and lint on affected files; expect pass. Commit `refactor: add shared semantic input validation`.

## Task 3: Adopt input definitions without weakening transactions

**Files:** Create feature form files and `tests/domain/form-consumers.test.ts`; modify domain barrel, birthday/poll domain files, birthday/poll services, `src/infra/db/birthdays/repo.ts`, `src/infra/db/polls/repo.ts`, and affected feature tests.

**Interfaces:**

- `birthdayForm: FormDefinition<{ day: number; month: number; visibility: BirthdayVisibility }>`; integer day 1-31, month 1-12, existing visibility choices.
- `pollResponseForm(options: readonly { id: number; label: string }[], multiple: boolean): FormDefinition<{ choices: number[] }>`; empty array allowed for clearing; single-choice cardinality applies after existing deduplication.
- Existing `validateBirthday(month, day): void`, repository methods, and service request signatures stay compatible. Features translate generic issues into current UserError messages.

- [x] Write failing composition tests with these assertions: day/month remain numbers; February 30 throws the existing invalid-date error; missing/unrecognized visibility retains the existing public fallback; numeric poll choices retain IDs and duplicate normalization; `[]` clears a vote.
- [x] Add repository/service regressions: `[id, id]` counts as one choice, two distinct IDs fail a single-choice poll, IDs from another poll fail, closed polls reject changes, repeated voter updates replace existing votes. Reuse existing tests where they already pin these exact cases.
- [x] Run focused tests; expect new definition imports to fail before implementation.
- [x] Implement birthday and poll definitions from Task 2. Normalize at feature boundaries, preserving existing behavior. Extract shared pure membership/cardinality predicates as needed and use them in the existing locked vote transaction; do not remove open-state or membership checks from the transaction.
- [x] Keep date validity and vote rules feature-owned, and keep storage unchanged. Shared field checks must not change public error ordering/wording or add database writes for invalid responses.
- [x] Run domain tests plus birthday/poll service, web, and repository-backed regressions using the disposable database. Run typecheck/lint. Commit `refactor: compose birthday and poll input definitions`.

## Task 4: Extract accessible controls and migrate simple consumers

**Files:** Create UI module, selectors, and `tests/infra/web/ui.test.ts`; modify `layout.tsx`, `birthdays.tsx`, `events.tsx`, `movies.tsx`, and `eslint.config.ts`.

**Interfaces:**

- `Field({ id, label, help?, error?, children })`: label/control relationship and help/error IDs; controls receive corresponding attributes through typed props.
- `Input`, `Textarea`, `Select`: Hono native JSX attributes plus label/help/error presentation, composing Field. Preserve `name`, `id`, native attributes, children, and existing `aria-describedby` associations.
- `Checkbox`, `MultiSelect`, `ActionButton`: preserve existing public prop semantics while moving to the UI module.
- `FormActions({ children })`: existing `role="group"` submit grouping.
- `ChannelOptions`, `ChannelSelect`: preserve existing signatures in selectors and compose generic Select.

- [x] Write failing render tests using Hono JSX `jsx` factory from `.test.ts`: label points to control ID; help/error IDs appear in descriptions; invalid field sets `aria-invalid`; `<script>` input is escaped; two controls with the same name and different supplied IDs have distinct associations. Assert native min/max/maxlength/required, checked/selected/value, and option order remain present.
- [x] Run `pnpm exec vitest run tests/infra/web/ui.test.ts`; expect missing module failure.
- [x] Implement small controls with typed native attributes. Use ordinary children for custom content and avoid embedding services or Form validation. Preserve existing CSS classes; add no JavaScript runtime.
- [x] Move server selectors out of layout. Migrate birthdays, events, and movies, preserving field names, defaults, actions, and ordering. Use a temporary layout re-export for unmigrated consumers only, avoiding cycles.
- [x] Extend existing import/boundary lint file globs from `.ts` to `{ts,tsx}` where needed; preserve current rules and public-barrel requirements. Verify the boundary rule applies with `pnpm exec eslint --print-config src/infra/web/events.tsx`.
- [x] Run UI tests, existing web feature regressions, typecheck, and lint. Commit `refactor: share accessible web controls`.

## Task 5: Finish UI adoption

**Files:** Modify `psa.tsx`, `polls.tsx`, `roles.tsx`, `permissions.tsx`, remaining shared-control imports, and existing web regressions; remove temporary re-exports from layout.

**Interfaces:** Consumes Task 4 exports; no new generic table, card, or form renderer.

- [x] Add only missing request regressions for checkbox omission, repeated multi-select values, and cleared event fields. Assert parsed service calls equal the prior request shapes; retain current list/form routes and permission visibility.
- [x] Run affected tests to prove new coverage against current behavior. Extraction-only changes do not need contrived failing tests that merely assert a component's name.
- [x] Replace repeated field/action markup using UI exports. Keep role editor rows, tables, PSA preview, permission decisions, and feature parsing local. Extract Section/EmptyState only if actual repeated structure benefits.
- [x] Remove obsolete imports/re-exports and run UI/web regression tests, typecheck, lint, and formatting on changed files. Commit `refactor: adopt shared controls across dashboard forms`.

## Task 6: Extract pure message presentation

**Files:** Create core presentation module and `tests/core/presentation.test.ts`; modify event/poll/announcement services and existing rendering tests. Add public presentation export to lint module patterns if needed.

**Interfaces:**

- `postView(post: Post): Message` initially consumes the structurally equivalent Announcement record until Task 7 introduces Post.
- `eventView(event: Event, counts: RsvpCounts): Message`, `reminderText` existing signature, `rsvpLabels` existing type.
- `pollView(poll: PollWithOptions, results: PollResults, now: Date): Message` in pure presentation; the legacy service signature supplies current time, `describeOutcome` existing signature, and `pollDetails` existing input/output signature.
- Services re-export old public renderer names; `announcementView` aliases `postView`. No core presenter imports services or infra.

- [x] Add missing assertions for cancelled event controls, icon preference, same-day/end-date timestamps, chosen-role mentions, message-length rejection, and poll detail option ordering. Reuse current `poll-rendering` and `event-length` cases rather than copying them.
- [x] Run focused renderer tests before extraction to establish behavior.
- [x] Move pure rendering with its constants/helpers; keep permission, parsing of requests, repository, scheduling, and side effects in services. Preserve exact output/errors and announcement length 1900 / rendered content limit 2000.
- [x] Run focused tests, web preview regressions, typecheck/lint. Confirm renderers do not mutate inputs. Commit `refactor: separate message presentation from feature services`.

## Task 7: Extract the managed Post lifecycle

**Files:** Create `src/core/ports/posts.ts`, `src/core/services/posts.ts`, `tests/core/services/posts.test.ts`; modify announcement port/service, public barrels, database announcement repository, `src/app.ts`, and post presenter types.

**Interfaces:**

- Post/PostStatus/NewPost/PostChanges/PostRepository have the current Announcement counterparts' field/method shapes; Announcement names become type aliases.
- `PostDraft` retains the current AnnouncementDraft shape; `PostService` exposes existing `jobs/view/list/get/draft/edit/publish/schedule/cancel` signatures.
- `createPostService({ posts, scheduler, messenger, directory, authz, log, clock, timezone }): PostService` retains existing checks and private publication operation.
- `createAnnouncementService(deps): AnnouncementService` maps `announcements` to `posts` and delegates; no duplicate lifecycle. `createPostRepository(db): PostRepository` owns existing repository implementation; `createAnnouncementRepository` is a compatibility alias.

- [x] Write failing direct Post API tests (no announcement adapter import) for draft/publish/edit/cancel and denied actor operations. Assert cross-community reads and invisible channels fail; other authors cannot read drafts without `announcement:publish`; publish/schedule require their existing permission IDs; forbidden channel/mentions are rejected.
- [x] Pin legacy job compatibility: `jobs` includes type `announcements.publish`; payload `{ announcementId }` executes; key remains `announcement:${id}`. Future due time reschedules; more than 3600000 ms lateness skips; current state gates publication.
- [x] Pin claims/recovery: concurrent publication sends once; transient failure restores prior eligible state; PermanentError/UserError restores draft; published edit uses `mentions: {}`; repeat cancel/publish preserve errors. Extend existing Postgres tests for atomic claims rather than relying only on in-memory fakes.
- [x] Run new tests to confirm missing Post exports fail.
- [x] Move existing implementation into posts with exact permissions, wording, logging fields, keys, queued payload, and storage preserved. Use Clock as before. Private background publication is not returned as a bypass API. Preserve current validation/write ordering; do not hide fixes inside renames.
- [x] Update composition to construct the Post implementation/repository while keeping the `announcements` web/command service surface. Add no new table or dual writes.
- [x] Run Post/announcement tests, audit visibility regressions, web PSA tests, app composition tests, typecheck/lint/build. Commit `refactor: extract managed posts from announcements`.

## Task 8: Isolate calendar contract, mapping, and adapter

**Files:** Create calendar port, core calendar module, Discord calendar module, and focused calendar tests; modify chat port, ports/Discord barrels, event service, combined Discord adapters, and lint module patterns.

**Interfaces:**

- `Calendar` and `CalendarEvent`: unchanged signatures, moved from chat.
- `eventCalendarEntry(event: Pick<Event, 'title' | 'description' | 'location' | 'startsAt' | 'endsAt'>): CalendarEvent`: pure mapping; null description -> `''`, null location -> `'See the event post'`, null end -> start + 7200000 ms.
- `createDiscordCalendar(client: Client): Calendar`: existing provider operations moved intact.

- [x] Write failing mapping test asserting exact fallback values and explicit values untouched, plus input immutability.
- [x] Add SDK-fake tests: null external ID creates, existing ID edits/returns same ID, remove deletes; title/description/location limits remain 100/1000/100. SDK failure propagates to service policy.
- [x] Run focused tests; expect missing module failure.
- [x] Move contract/adapter, implement pure mapping, and let event service use it while retaining native opt-in, reference updates, cancellation, and warning-and-continue behavior.
- [x] Verify event lifecycle regressions cover calendar failures retaining old references and post/reminder behavior. Run focused tests, typecheck/lint. Commit `refactor: isolate calendar mapping and Discord adapter`.

## Task 9: Document, verify, and stop

**Files:** Modify README architecture/development examples and the baseline record; update this plan's checkboxes from actual execution evidence.

**Interfaces:** Produces final branch evidence and practical extension examples; no new product API.

- [x] Document predefined birthday input, specialized poll input, accessible UI controls, managed posts, ordinary Message delivery, and calendar adapters using actual exports from Tasks 2-8. Explicitly identify existing Discord syntax and deferred persisted links.
- [x] Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`, and dedicated database integration tests when available. Record failures/skips accurately; do not count skipped tests as passed.
- [x] Review the full branch diff against spec sections 1-8: inspect authorization, transaction checks, jobs/payloads, mentions, duplicated lifecycle/rules, unused abstractions, and accidental formatting churn. Run `git diff --check`.
- [x] Commit docs/check evidence with `docs: describe consolidated foundation and validation`. Report changes, verification, and limitations. No merge, push, deployment, or scope expansion is implied.

## Plan self-review

Spec coverage: input contracts/proof/adoption (Tasks 2-3), UI/accessibility (4-5), presentation/ordinary deliveries (6), managed lifecycle/authorization/storage/scheduling (7), integrations (8), compatibility and evidence (1/9). All five Review Focus conditions are assigned above. Post aliases preserve service signatures, UI exports do not import feature services, and transaction checks are retained. Custom forms, persistent links, and new providers remain excluded.
