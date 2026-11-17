# Foundation physical layout

Historical execution record. Its physical layout is superseded by the approved
[capability locality follow-up](2026-11-17-local-reasoning.md).

Approved in chat after the foundation implementation. Execute inline on
`fix/consolidate-foundation`; baseline is `f96291f` with 234 tests passing.
Use the safe-refactor workflow: preserve runtime behavior, verify before and
after, and make mechanical moves with scripted import updates.

## Ownership rules

- Domain feature directories own their records, pure rules, and input definitions.
- Core capability directories own use cases, repository contracts, message
  construction, and feature-specific mappings. Shared external capabilities
  stay in `core/ports`; `defineJob` stays a small shared core utility.
- Infrastructure owns concrete provider/database adapters and web pages/controls.
- Imports across capabilities use their public barrels; imports within one
  capability reference its local files. No catch-all core services/presentation
  barrels and no internal announcement aliases.
- Physical database names, enum/index names, public commands/URLs/messages,
  permission names, and queued job keys/payloads remain unchanged.

## Work

- [x] Move records from feature ports into domain models; colocate pure rules
      and input definitions under their owners.
- [x] Move core services, repository ports, messages, and event calendar mapping
      into capability directories; migrate imports and remove obsolete barrels.
- [x] Put Post persistence in `infra/db/posts` while retaining SQL names;
      migrate announcement aliases to Post names and remove the aliases.
- [x] Split Discord messenger/directory files; move web route implementations
      under `web/pages`; mirror capability ownership in tests.
- [x] Update import lint rules and architecture documentation.
- [x] Run typecheck, lint, formatting, build, and the same 234-test database suite.
      Perform one independent review of the structural diff and address regressions.

No product behavior or dependencies are added. Existing regression tests are
the preservation proof; no tests are added merely to assert file locations.

## Verification and review

- Baseline: 234 tests passed before moving files.
- Final: all 234 tests passed across 41 files with the dedicated disposable
  PostgreSQL; zero skipped tests and unchanged assertions.
- Typecheck, full ESLint, formatting, production build, and staged whitespace
  checks passed. Import restrictions now recognize capability public barrels.
- Drizzle Post table/column/index/enum metadata matched the original adapter.
- An AST comparison confirmed that all runtime string/template literals across
  src/ match the baseline, excluding imports and type-only declarations.
- One independent reviewer examined the staged structural diff against
  f96291f and found no actionable issues or important layout omissions.

Review boundary: live Discord/Redmine calls were not made. This is a physical
reorganization with preserved adapter logic, verified by the regression suite
and source comparison. Tradeoff: live provider behavior was not independently
exercised; no provider behavior change is claimed.

Internal Announcement aliases and the catch-all core services/presentation
modules are removed. Runtime announcement names remain where required for
public wording, permissions, queued jobs, and SQL compatibility. The pure poll
renderer is renderPoll; the clock-owning pollView helper remains in its owning
poll service. No new product behavior, schema migration, or dependency was added.
