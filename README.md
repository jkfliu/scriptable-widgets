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
  check-secrets.js       scans a bundle for API keys and personal data
  deploy.sh              optional: copies dist/ into the iCloud Scriptable folder on a Mac
  release.sh             release one widget: tests, build, version update
test/                    tests for the build and the bundles in dist/
AGENTS.md                working rules, including TDD (CLAUDE.md imports it)
PLAN.md                  phased plan
```

`dist/` is committed on purpose: the update checker downloads scripts from this repo, and scripts are installed on the phone from GitHub.

## Requirements

Node 22 or later (see `.nvmrc`). There are no dependencies to install.

## Commands

```sh
npm test                          # run all tests (node --test)
npm run build                     # build all widgets into dist/
node scripts/build.js <widget>    # build one widget, e.g. sg-haze
npm run deploy                    # Mac only: build, then copy dist/ to iCloud Scriptable
node scripts/check-secrets.js <file>   # scan a file for keys and personal data
```

Each widget's `widget.json` drives its build:

```json
{
  "name": "SG Haze",
  "output": "SG Haze.js",
  "version": "1.0.0",
  "shared": [],
  "icon": { "color": "blue", "glyph": "smog" },
  "updateRepo": "jkfliu/sg-haze-widget"
}
```

`shared` lists modules from `shared/` (without `.js`) to include, in order. `icon` sets Scriptable's icon header. `updateRepo` is optional and fills in `UPDATE_REPO` in the widget.

After changing any widget source, run `npm run build` and commit `dist/`: a test checks that the committed `dist/` matches a fresh build.
