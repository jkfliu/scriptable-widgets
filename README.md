# scriptable-widgets

iOS widgets for [Scriptable](https://scriptable.app), kept in one repo with shared code and one build setup. Each widget still builds into its own single-file script in `dist/`, so it can be shared and versioned on its own.

Widgets (planned, see [PLAN.md](PLAN.md)):
- **SG Haze**: moved in from the old `sg-haze` repo
- **Market Prices**: FX, stocks and crypto prices

## Layout

```
shared/                  shared logic used by several widgets, with tests
widgets/<name>/
  widget.json            name, output filename, version, shared modules used
  src/core.js            pure, tested logic
  src/widget.js          thin Scriptable layer (requests, Keychain, cache, drawing)
  test/                  node:test tests
  test/fixtures/         real API responses, documented in a README
  version.json           used by the update checker
  CHANGELOG.md
dist/                    built single-file scripts (committed)
scripts/
  build.js               builds one widget or all of them into dist/
  deploy.sh              optional: copies dist/ into the iCloud Scriptable folder on a Mac
  release.sh             release one widget: tests, build, version update
AGENTS.md                working rules, including TDD (CLAUDE.md imports it)
PLAN.md                  phased plan
```

`dist/` is committed on purpose: the update checker downloads scripts from this repo, and scripts are installed on the phone from GitHub.

## Requirements

Node 22 or later (see `.nvmrc`). There are no dependencies to install.

## Commands

```sh
npm test                          # run all tests (node --test)
npm run build                     # build all widgets into dist/   (from Phase 2)
node scripts/build.js <widget>    # build one widget               (from Phase 2)
```
