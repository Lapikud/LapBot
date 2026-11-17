# Foundation consolidation verification

Implemented on `fix/consolidate-foundation`, starting from `61879f9`.
No schema migration or new dependency was needed.

## Verification

- Full regression suite with dedicated PostgreSQL: **234 passed, 0 skipped**,
  across 41 test files.
- Typecheck: passed after the review corrections.
- ESLint: full repository passed; changed files passed again after corrections.
  Existing module-boundary rules now include TSX.
- Formatting: checked across the repository.
- Production build: passed after corrections.
- Diff whitespace check: passed.

The final full suite used `pnpm test` with TEST_DATABASE_URL explicitly pointing
at the disposable `lapbot_test` database on 127.0.0.1:5433. It did not use the
development database. Earlier default tests without that variable passed
133 tests and skipped 100 database-dependent tests; the final database-enabled
run above supersedes those skips.

The original database baseline had 211 passing tests and one stale movie
assertion. The assertion expected an inline trailer link, although the existing
publisher sends links in ordered detail messages before voting controls. It
now verifies that actual publication behavior; product output was preserved.

## Independent review and corrections

One fresh reviewer examined the full implementation range
`61879f9..9cd0845`, including the five review-focus conditions. No critical or
important runtime defects were reported, and nothing was declined for judgment.
Two issues were reported as minor but resolved as acceptance-contract fixes:

1. Restore the exact original announcement length-error wording.
2. Make the pure poll renderer accept an explicit Date, preserving the old
   two-argument renderer at the service boundary that supplies current time.

Both regression tests failed before the corrections and passed afterward.
The complete 234-test database-enabled suite then passed. No review findings
were deferred.

## Implementation decisions and tradeoffs

These decisions record deviations or details settled during execution:

1. Keep the user-requested branch in the current checkout. This follows the
   approved plan instead of silently creating a worktree. Tradeoff: changes
   share the existing checkout with other local work.
2. Correct the stale movie test rather than change the existing output.
   Tradeoff: inline trailer links remain absent from the compact poll message;
   links remain in detail messages.
3. Preserve literal keys in field-constructor return types. The planned broad
   string return conflicted with keyed FormDefinition types. Tradeoff: an
   additional inferred TypeScript key parameter.
4. Keep poll validation inside the existing transaction and fetch option
   definitions under its lock. Tradeoff: one complete option-list query per
   vote; polls support at most ten options.
5. Commit UI extraction and adoption together so removal of transitional layout
   exports leaves one coherent commit. Tradeoff: a larger UI review chunk.
6. Resolve both review findings despite their minor labels because wording
   compatibility and deterministic presentation are explicit acceptance
   conditions. Tradeoff: one additional explicit-time presentation argument.
7. Retain the service-level two-argument poll renderer as a clock-owning
   compatibility boundary. Tradeoff: one small intentional adapter function,
   rather than changing all established callers or hiding wall-clock access
   inside pure presentation.

## Remaining boundaries

Existing permission IDs, announcement tables, command routes, queued job names,
payloads, claim/retry policies, and ordinary deliveries remain compatible.
Rendering still uses Discord text syntax. Persisted event/poll-to-post links,
custom forms, and multiple calendar destinations remain outside this scope.
