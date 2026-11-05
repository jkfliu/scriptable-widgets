# TDD rules

## Workflow
- Work test-first for all logic. For each change:
  1. Write or update a test that describes the behaviour.
  2. Run it and confirm it fails for the expected reason.
  3. Write the minimum code to make it pass.
  4. Refactor while keeping all tests green.
- Work one phase of PLAN.md at a time. At the end of each phase, summarise the changes and test results, then stop and wait for approval before starting the next phase.
- Never weaken, skip, or delete a test to make it pass. If a test seems wrong, explain why and ask before changing it.
- When moving existing code, behaviour must not change. Existing tests must pass before and after every move.

## Commands
- Run all tests: `npm test` (runs `node --test`)
- Build all widgets: `npm run build`, or one widget: `node scripts/build.js <widget>`
- Run the full test suite before finishing any task, and report the result.

## Structure
- Use Node 22+ and the built-in `node:test` and `node:assert` modules. Do not add dependencies.
- Shared logic lives in `shared/` with its tests. Each widget lives in `widgets/<name>/`.
- In each widget, all logic lives in `src/core.js` as pure functions exported with `module.exports`, and every function there has tests.
- `src/widget.js` is the Scriptable layer: requests, Keychain, file cache, drawing. Keep it thin and free of logic. If logic creeps in, move it to `core.js` (or `shared/`) and test it there.

## Fixtures
- Base parser tests on real API responses saved in `widgets/<name>/test/fixtures/`. Do not invent response shapes.
- Document each fixture's source URL, capture date, and structure in that folder's `README.md`.
- Tests must not make network calls.

## Edge cases to cover
- Time: pass `now` into time functions as a parameter; never read the clock inside them. Test Singapore (UTC+8) versus UTC around midnight.
- Data: missing values, nulls, duplicate timestamps, unknown inputs, malformed JSON.
- Boundaries: test exact boundary values on both sides.
- Versions: comparisons like 1.10.0 vs 1.9.0, equal versions, malformed strings.

## Bundle checks
- Every built bundle in `dist/` must be valid JavaScript.
- No bundle may contain an API key value or other secrets.
- The committed `dist/` must match a fresh build.
