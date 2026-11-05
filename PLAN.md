# scriptable-widgets — plan

## Goal
A single repo for my Scriptable widgets, with shared code and one build setup. Each widget still builds into its own single file, so it can be shared and versioned on its own.

Initial widgets:
- SG Haze, moved in from my existing sg-haze GitHub repo
- Market Prices, new

This repo is worked on through Claude Code cloud sessions. Network access allows api-open.data.gov.sg, query1.finance.yahoo.com and api.coingecko.com. Built scripts are committed in dist/, and I install them on my phone from GitHub.

## Ground rules
- Work test-first. Write a failing test, make it pass, then tidy up.
- After each phase, summarise what changed and wait for my approval before starting the next.
- Don't add dependencies. Use Node's built-in test runner (node --test) on Node 22 or later.
- All logic goes in pure functions tested under Node. Scriptable-specific code stays thin and untested.
- When moving existing code, behaviour must not change. Existing tests must pass before and after every move.

## Repo layout
```
shared/                  shared logic used by several widgets, with tests
widgets/
  sg-haze/
    widget.json          name, output filename, version, shared modules used
    src/core.js
    src/widget.js
    test/
    test/fixtures/
    version.json
    CHANGELOG.md
  market-prices/         same structure
dist/                    built single-file scripts (committed)
scripts/
  build.js               builds one widget or all of them into dist/
  deploy.sh              optional: copies dist/ into the iCloud Scriptable folder when run on a Mac
  release.sh             release for one widget: tests, build, version update
AGENTS.md / CLAUDE.md    shared instructions, including the TDD rules
README.md
```

## Phases

### Phase 0: Repo setup ✅ Done
- [x] package.json, .nvmrc, .gitignore (dist/ is committed)
- [x] AGENTS.md with the TDD rules; CLAUDE.md imports it
- [x] README describing the layout

### Phase 1: Move SG Haze in ✅ Done
Imported from jkfliu/sg-haze-widget with git filter-repo (full history kept). 153 tests pass, 1 live test skipped; the build is byte-identical to the old repo's.

- Import my sg-haze GitHub repo into widgets/sg-haze/ with its git history preserved (e.g. git subtree add or git filter-repo). Ask me for the repo name if needed, and propose the method before doing it.
- Update paths so its tests pass in the new location with no logic changes.
- Use its existing build script for now, or a temporary version adapted to the new paths.
- Check: the built SG Haze.js matches the old repo's build, apart from paths.
- Stop for review.

### Phase 2: Multi-widget build (tests first) ✅ Done
widget.json also takes `icon` (Scriptable header) and an optional `updateRepo`. check-secrets.js moved to the root scripts/. SG Haze's root build is byte-identical to its old build; its own build/release scripts stay until Phase 3.

- Each widget gets a widget.json: { "name", "output", "version", "shared": [...] }.
- scripts/build.js:
  - node scripts/build.js sg-haze builds one widget; with no argument it builds all of them.
  - It combines the listed shared modules, the widget's core.js and its widget.js into dist/<output>.
  - It strips the module.exports lines and sets VERSION from widget.json.
  - Keep it to plain file concatenation, with no bundler.
- Tests:
  - each bundle is valid JavaScript
  - a bundle includes only the shared modules its widget lists
  - no bundle contains an API key value or other secrets
  - the committed dist/ matches a fresh build
- scripts/deploy.sh copies everything in dist/ to ~/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents/ (only useful on a Mac).
- Stop for review.

### Phase 3: Pull out shared code (tests first) ✅ Done
shared/time.js, shared/update.js (including isPlausibleUpdate) and shared/storage.js, each with tests. updateUrl(repo, widget, script); the build fills in UPDATE_WIDGET and UPDATE_SCRIPT, and checks shared requires are listed in order. SG Haze 1.1.0 updates from this repo; its old build, release, deploy scripts and release/ are retired. Preview output is byte-identical before and after.

Move these from SG Haze into shared/, along with their tests:
- formatUpdated(time)
- isStale(latestTime, now, maxAgeMinutes)
- the file cache and Keychain helpers, as thin wrappers
- the update checker: compareVersions, parseManifest, shouldCheckForUpdate, updateUrl
  - updateUrl takes the widget's folder so that each widget has its own version.json path and dist/ script URL in this repo.

Also:
- Generalise functions only where needed, adding parameters instead of hardcoded haze values.
- Switch SG Haze to the shared versions. All haze tests must still pass.
- Point SG Haze's update URL at this repo and bump its version.
- Stop for review.

### Phase 4: Market Prices — fixtures ✅ Done
scripts/fetch-fixtures.js is written and tested; it captured the CoinGecko fixtures. Yahoo returned HTTP 429 to the cloud session, so the Yahoo fixtures (D05.SI open, ^GSPC closed, USDSGD=X, an invalid symbol) were copied from Safari on the iPhone; two have their per-minute arrays trimmed. Shapes are documented in widgets/market-prices/test/fixtures/README.md. CBA.AX and SGDJPY=X not captured yet.

Write a small Node script that downloads and saves real responses to widgets/market-prices/test/fixtures/:
- Yahoo, from https://query1.finance.yahoo.com/v8/finance/chart/{symbol}:
  - stocks: D05.SI, CBA.AX, ^GSPC
  - FX: USDSGD=X, SGDJPY=X
  - ideally one captured while a market is open and one while it's closed
- CoinGecko, from https://api.coingecko.com/api/v3/simple/price?ids=...&vs_currencies=...&include_24hr_change=true:
  - bitcoin,ethereum,solana in USD and in SGD
- One invalid symbol from each source, to see the error responses.

Document the response shapes in the fixtures README. In particular, note which Yahoo fields give the current price, previous close, last trade time, trading hours and currency. Stop for review.

### Phase 5: Market Prices — parameters (tests first) ✅ Done
Also added resolveParameter(param, family), which applies the default fallback and keeps a valid cur:. FX pairs may be written USDSGD or USD/SGD. Input is case-insensitive; FX and stocks are stored uppercase, crypto and cur lowercase; malformed items are dropped and recorded.


Parameter format:
```
fx:USDSGD,SGDAUD,SGDJPY | stocks:D05.SI,CBA.AX,^GSPC | crypto:btc,eth,sol | cur:usd
```
- Groups are separated by |, and items within a group by commas. Spaces and letter case are ignored.
- cur: sets the currency for crypto prices only. The default is usd.
- Stocks always show in their listing's own currency, and FX pairs are rates.

Functions:
- parseParameter(param) returns { groups (in the order listed), currency, errors }.
  - Each group is capped at 5 items.
  - Unknown group names and malformed parts are ignored and recorded in errors.
  - Duplicates are removed.
- defaultParameter(family) returns the default string for each size:
  - medium: fx:USDSGD,SGDAUD,SGDJPY | stocks:^STI,^AXJO,^GSPC | crypto:btc,eth,sol | cur:usd
  - small: fx:USDSGD | stocks:^STI,^GSPC | crypto:btc,eth | cur:usd
  - Use it when the parameter is empty, or when nothing valid is left after parsing.
- smallItems(parsed) returns the first 5 items across all groups, in the order listed.
- columnsFor(parsed) returns only the groups that are present, in order.
- toYahooSymbol(item, type) turns USDSGD into USDSGD=X and leaves stock tickers as they are.
- toCoinGeckoId(symbol) maps common symbols to CoinGecko IDs and passes unknown ones through.

Tests:
- empty input, extra spaces, mixed case
- groups with 1 to 4 items keep exactly those items
- small with fewer than 5 items in total
- a parameter with no valid items falls back to the default

### Phase 6: Market Prices — responses (tests first) ✅ Done
parseYahooChart(json, now) also takes now, for marketOpen: now within currentTradingPeriod.regular [start, end), or null if unknown. Unavailable items are { available: false, reason }. Both parsers accept JSON text or parsed JSON; parseCoinGecko returns a Map. direction uses change24h when the item has it, else price vs previous close.

- parseYahooChart(json) returns { price, previousClose, time, marketOpen, currency }.
- parseCoinGecko(json, ids, currency) returns a map of ID to { price, change24h }.
- direction(item) returns up, down or flat, using the previous close for FX and stocks and the 24-hour change for crypto.
- Missing fields, nulls and error responses should produce an "unavailable" item rather than a crash.

### Phase 7: Market Prices — labels and formatting (tests first) ✅ Done
label(item) takes { type, symbol }; extra index names ^DJI Dow, ^IXIC Nasdaq, ^N225 Nikkei (^HSI stays HSI to fit). formatPrice rounds half away from zero with US-style separators whatever the phone's region; FX gets separators too; a crypto value that rounds up to 1 or 100,000 uses the next rule; B after M. COLUMN_MAX_CHARS = 18 (label, space, price, arrow), a first estimate to check on the phone in Phase 8.

- label(item):
  - FX: USDSGD becomes USD/SGD
  - stocks: drop the exchange suffix, e.g. D05.SI becomes D05
  - indices: friendly names, e.g. ^GSPC → S&P 500, ^STI → STI, ^AXJO → ASX 200; any other index loses its ^
  - crypto: uppercase symbol, e.g. BTC
- formatPrice(value, type, symbol, currency):
  - FX: 4 decimal places, or 2 for pairs quoted in JPY
  - stocks and indices: 2 decimal places with thousands separators, or 0 for prices in JPY
  - crypto: 2 significant decimals for prices under 1, whole numbers up to 99,999, and K or M abbreviations above that (e.g. 132.5K)
  - No currency symbols or tags.
- Test that typical labels and prices fit within a fixed maximum character count for a one-third-width column.

### Phase 8: Market Prices — Scriptable layer
- Read the parameter from args.widgetParameter and the size from config.widgetFamily.
- Fetch all Yahoo symbols (with a normal browser User-Agent) and the single CoinGecko request at the same time.
  - An optional CoinGecko key is stored in Keychain and sent in the x-cg-demo-api-key header.
- Use the shared cache to save the last good value for each item.
  - If a fetch fails, show the saved value dimmed.
  - If there's no saved value, show —.
- Layout:
  - No column headers. Rows are always top-aligned.
  - Medium: one column per group present, up to 5 rows each:
    - 3 groups: three columns
    - 2 groups: two wider columns
    - 1 group: one full-width column
  - Small: one column of up to 5 rows.
  - Each row has the label on the left, and the price followed by a ▲ or ▼ on the right.
- Colours: green for up, red for down, grey for flat or unavailable. Use colours that adapt to light and dark mode.
- Show a small "closed" marker on stock rows when that market is closed.
- Show a small "Updated 3:15pm" line, using the shared formatter.
- Set widget.refreshAfterDate to about 15 minutes ahead.
- Tapping the widget opens https://finance.yahoo.com.
- When the script runs inside the app rather than in a widget, show a menu with:
  - a small and a medium preview
  - set or clear the CoinGecko key
  - a help screen explaining the parameter format

### Phase 9: Market Prices — release
- Add widget.json, version.json and CHANGELOG.md.
- Add a README section covering:
  - adding the widget, with small and medium examples
  - the parameter format
  - ticker conventions: .SI for SGX, .AX for ASX, ^ for indices, FX pairs like USDSGD
  - installing on a phone from the dist/ file on GitHub
- scripts/release.sh <widget> runs the tests, builds that widget, and updates its version.json.

## Retiring the old sg-haze repo (after everything works)
This is a manual checklist for me, with Claude Code's help where useful.
1. Confirm the new SG Haze build works on my phone.
2. If any friends have update checks turned on:
   - Release one final version from the old repo whose update URL points to this repo.
   - Give it a higher version number so their update check picks it up.
   - Wait until friends have installed it.
3. Replace the old repo's README with a pointer to scriptable-widgets.
4. Archive the old repo on GitHub rather than deleting it. Archived repos stay readable, so any old update links keep working.
5. Delete it later only if I'm sure no one still depends on it.

## Out of scope for now
- Market Prices: mini trend lines, lock screen widgets, portfolio values
- Turning on Market Prices sharing and update checks (the shared update checker makes this easy later)
- Android support
