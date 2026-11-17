# Consolidation verification baseline

Branch: `fix/consolidate-foundation`, starting commit `61879f9`.
Node v26.7.0; pnpm 11.22.0. Checkout initially clean.

- Typecheck, lint, production build: passed.
- Formatting: passed after formatting generated, ignored execution notes.
- Tests without database: 120 passed, 92 skipped.
- Disposable database suite: 211 passed, 1 failed (212 total).

Existing failure: `tests/core/services/movies.test.ts` -> `links each poll
option to the movie trailer or link`. The assertion expects the trailer link
inside the compact poll message, while current rendering publishes links in
ordered detail messages. Inspect and correct this stale assertion during the
presentation extraction; preserve current publication behavior.

The isolated `postgres-test` service in `compose.test.yaml` is running at
127.0.0.1:5433 with database `lapbot_test`. Integration verification explicitly
sets TEST_DATABASE_URL to that disposable database, then invokes
`node node_modules/vitest/vitest.mjs run`. Its local test credentials are in
`.env.test`. Never inherit an arbitrary TEST_DATABASE_URL: setup resets schemas.
Sandbox networking requires elevated local execution for database tests.
