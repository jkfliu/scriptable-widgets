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
  "version": "1.1.0",
  "shared": ["time", "update", "storage"],
  "icon": { "color": "blue", "glyph": "smog" },
  "updateRepo": "jkfliu/scriptable-widgets"
}
```

`shared` lists modules from `shared/` (without `.js`) to include, in order: a module must come after any shared module it requires, and the build fails if a widget requires one it doesn't list. `icon` sets Scriptable's icon header. `updateRepo` is optional; when set, the build fills in `UPDATE_REPO`, `UPDATE_WIDGET` (the widget's folder) and `UPDATE_SCRIPT` (its output) in `widget.js`, and the update checker then reads `widgets/<folder>/version.json` and `dist/<output>` from that repo's `main`.

## Shared modules

| Module | What it provides |
|--------|------------------|
| `shared/time.js` | `isStale(latestTime, now, maxAgeMinutes)`, `formatUpdated(time)` ("Updated 3:15pm", Singapore time), `formatSgtTime`, `toMs`, `HOUR`, `DAY`, `SGT_OFFSET` |
| `shared/update.js` | `compareVersions`, `parseManifest`, `shouldCheckForUpdate`, `updateUrl(repo, widget, script)`, `isPlausibleUpdate`, `isVersion`, `versionLine` (requires `time`) |
| `shared/storage.js` | Thin Scriptable wrappers: `readJsonFile`, `writeJsonFile`, `keychainHas`, `keychainGet`, `keychainSet`, `keychainRemove` |

Each has tests in `shared/test/`. In Node, widgets require them as `require('../../../shared/<name>.js')`; the build strips those lines and puts the modules first in the bundle.

After changing any widget source, run `npm run build` and commit `dist/`: a test checks that the committed `dist/` matches a fresh build.
