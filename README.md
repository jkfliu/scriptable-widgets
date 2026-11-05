# scriptable-widgets

iOS widgets for [Scriptable](https://scriptable.app), kept in one repo with shared code and one build setup. Each widget still builds into its own single-file script in `dist/`, so it can be shared and versioned on its own.

| Widget | What it shows | Script | Details |
|--------|---------------|--------|---------|
| **SG Haze** | Singapore PM2.5 and PSI for one region, with a 24-hour chart | [`dist/SG Haze.js`](dist/SG%20Haze.js) | [widgets/sg-haze](widgets/sg-haze/README.md) |
| **Market Prices** | FX rates, stock and index prices, and crypto prices | [`dist/Market Prices.js`](dist/Market%20Prices.js) | [widgets/market-prices](widgets/market-prices/README.md) |

To install one on your phone, open its script in Safari ([Market Prices.js](https://raw.githubusercontent.com/jkfliu/scriptable-widgets/main/dist/Market%20Prices.js), [SG Haze.js](https://raw.githubusercontent.com/jkfliu/scriptable-widgets/main/dist/SG%20Haze.js)), tap **Share** › **Save to Files**, and save it in **iCloud Drive › Scriptable**. It then appears in Scriptable under the widget's name. Each widget's README has the details. [PLAN.md](PLAN.md) has the history of how the repo was built.

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
sh scripts/release.sh <widget> <version> "<notes>"   # release one widget
```

### Releasing a widget

```sh
sh scripts/release.sh market-prices 1.0.1 "Fixes the closed marker"
```

This checks the version is newer than the widget's last release, builds that widget, runs all tests, sets the version in its `widget.json`, builds it again into `dist/`, scans the bundle for secrets, and writes its `version.json`. If a check or test fails, it stops before changing the version (only the first build may have refreshed `dist/`). Then add a CHANGELOG entry, commit, tag (`market-prices-v1.0.1`) and push. Widgets with update checks (SG Haze) offer the new version once it's on `main`.

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
