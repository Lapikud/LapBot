# Capability locality follow-up

User approved the proposed correction with “fix all that then”. Execute inline
on `fix/consolidate-foundation`, baseline `6e66e02`. This supersedes the previous
physical layout, not its preservation requirements.

## Outcome

Understand a feature from one directory. Logical purity and adapter boundaries
remain enforced without separate domain/core trees or mandatory barrels.

- `foundation/`: independently useful forms, post content, message values, actor,
  roles, permissions, time, external capabilities, UI controls, and job validation.
- `features/<name>/`: models and repository contracts together; rules, inputs,
  service, messages, calendar mapping, database table/repository, Discord commands,
  web routes and tests together. Create files for actual responsibilities only.
- `integrations/`: shared database connection, Discord transport/router, web host,
  scheduler, logging, TMDB and Redmine provider clients/contracts.
- Composition stays in app.ts. Imports name the actual defining file, with local
  imports inside a capability. Remove re-export-only index files.
- Announcement lifecycle, permissions, queued work and persistence are an
  announcement workflow. A foundation Post contains content and explicit mention
  choices only; its pure renderer has no repository, permissions or scheduling.
  Announcement rendering composes it and applies existing announcement errors.
- Provider contracts own provider-shaped issue/catalog data; foundation cannot
  import feature implementation. Services/rules/models cannot import adapters.

## Preservation

No schema migrations, command registration, provider calls, dependencies or
product changes. Preserve SQL metadata, runtime/public strings, errors, job
identifiers/payloads/keys, claim/send ordering, visibility and permissions.
Existing 234 tests bracket the moves; add focused tests for reusable post content.

## Execution

- [x] Establish baseline; map imports and ownership.
- [x] Move feature slices/adapters/tests; simplify contracts and barrels.
- [x] Separate post content from announcement workflow with regression coverage.
- [x] Enforce logical boundaries at file level; update configuration and docs.
- [x] Verify typecheck, lint, format, build, full DB suite and independent review.

## Evidence so far

- Baseline: 234/234 tests, dedicated disposable test PostgreSQL.
- After moves and extraction: 238/238 tests across 42 files, zero skipped.
- Four new pure post rendering tests failed on the missing module before the
  implementation, then passed; existing assertions preserved.
- SQL metadata comparison: all 16 tables, columns, defaults, indexes, constraints
  and enums match baseline `6e66e02`.
- AST comparison: all non-import runtime string/template literals across src
  match baseline, excluding tests and type-only declarations.
- Six ESLint probes reject adapters in operations, features in foundation and
  Discord SDK in services; allow injected provider contracts and Discord adapters.
- Typecheck, full lint, formatting and production build passed. One independent
  final review found no functional issues or missing locality changes.

No new provider calls, schema migrations, dependencies or product behavior.

## Final review and completion

The reviewer noted a nonblocking maintenance limitation: a hardcoded list of
feature names in the lint configuration. The final configuration uses capability
wildcards instead. A temporary new-capability service importing a concrete
repository bypassed the old rule (RED); the updated rule rejected it (GREEN).
All six boundary probes then passed, including the existing provider-contract
and Discord-adapter allowance checks. The temporary source was removed.

Implementation remains inline. No new universal publishing service was added:
Messenger is the existing delivery capability, Scheduler handles jobs, and the
announcement feature composes these with Post. This keeps concrete lifecycle
policy local without another forwarding layer. Feature file names describe
responsibilities and are not scaffolding requirements.

Review boundary: local structural/preservation checks and disposable-database
regressions; live Discord, TMDB and Redmine services were not called. Nothing was
pushed or merged. Work stays on `fix/consolidate-foundation`.

## User correction: core name and test placement

The user requires `core/` rather than `foundation/`, and no tests under src.
The shared primitive directory is now `src/core/`. Feature tests mirror their
owners under `tests/features/<name>/`; primitive tests live in `tests/core/`.
Vitest discovers only `tests/**/*.test.ts`. Earlier descriptions in this record
are historical and superseded by this correction. Imports and lint boundaries
follow the new physical locations; feature ownership and runtime logic stay the
same.

Correction verified: all 238 tests passed across 42 files from tests/; typecheck,
lint, formatting and production build passed. Confirmed no test/spec files in src
and no remaining foundation imports in code or current README.

## User correction: helper and port grouping

Shared utility implementations are grouped in `src/core/helpers/`: async, time,
visibility, role/permission checks, authorization guard, validated job definition
and system clock. External capability contracts are grouped in `src/core/ports/`:
authorization, calendar, clock, directory (including RoleInfo), logger, messenger,
scheduler, movie catalog and issue tracker. The catalog/issue data types are
owned by their ports; provider SDK implementations remain in integrations.
Feature repository contracts remain local to feature models. Core's root retains
shared actor, permission, error, message and post primitives; forms/UI retain their
existing dedicated directories. Mixed contract/helper files have been separated.

Separate pre-existing logging edits include malformed test syntax. Verification
therefore runs against an isolated temporary copy of HEAD plus only this refactor;
the working copy's logging changes are preserved and excluded from the commit.

Helper/port correction verified in the clean copy: all 238 tests passed across
42 files, plus typecheck, ESLint, formatting and production build. A SHA-1 Git
blob comparison confirmed all 169 indexed source/test/script/config/README files
match the verified copy. All 11 original logging edit bodies are preserved
exactly in the working copy and excluded from the staged refactor.
