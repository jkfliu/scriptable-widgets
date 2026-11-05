# Market Prices

A [Scriptable](https://scriptable.app) widget for iPhone showing FX rates, stock and index prices, and crypto prices, with ▲/▼ for the day's direction.

Prices come from Yahoo Finance (FX, stocks, indices) and CoinGecko (crypto). No account or key is needed.

## Install on your phone

1. Install the free [Scriptable](https://apps.apple.com/app/scriptable/id1405459188) app and open it once.
2. On the iPhone, open **[Market Prices.js](https://raw.githubusercontent.com/jkfliu/scriptable-widgets/main/dist/Market%20Prices.js)** in Safari.
3. Tap **Share** › **Save to Files**, choose **iCloud Drive › Scriptable**, and tap **Save**.
4. Open Scriptable: **Market Prices** is in the list. Tap it to run it; a menu lets you preview the small and medium widgets.

This uses Scriptable's folder in iCloud Drive, so iCloud Drive needs to be on for Scriptable.

**To update later**, download it the same way and choose **Replace** when Files asks. Your widgets, Parameters, saved prices and CoinGecko key all stay as they are.

**Is there a new version?** From 1.1.0, the widget tells you (see [Updates](#updates)). To see which version you have, run the script in Scriptable: the menu shows it at the top. What changed in each version is in [CHANGELOG.md](CHANGELOG.md).

**Or copy and paste:** if the download doesn't work for you, open [`dist/Market Prices.js`](https://github.com/jkfliu/scriptable-widgets/blob/main/dist/Market%20Prices.js) on GitHub, tap **Raw**, and copy all of it. In Scriptable, tap **+**, paste, then tap the title at the top and rename the script **Market Prices**.

## Add the widget

1. Long-press the home screen, tap **Edit** › **Add Widget**, choose **Scriptable**, and pick the **small** or **medium** size.
2. Long-press the new widget, tap **Edit Widget**, and set **Script** to *Market Prices*.
3. Optionally set **Parameter** to choose what it shows (see below). Leave it empty for the defaults.

### Examples

**Medium**, three columns (FX, stocks, crypto):

```
fx:USDSGD,SGDAUD,SGDJPY | stocks:D05.SI,CBA.AX,^GSPC | crypto:btc,eth,sol | cur:usd
```

**Medium**, two wider columns:

```
stocks:D05.SI,O39.SI,U11.SI,^STI | crypto:btc,eth
```

**Small**, one column of up to 5 rows (the first 5 items, in order):

```
fx:USDSGD | stocks:^STI,^GSPC | crypto:btc,eth
```

With no Parameter, medium shows `fx:USDSGD,SGDAUD,SGDJPY | stocks:^STI,^AXJO,^GSPC | crypto:btc,eth,sol | cur:usd` and small shows `fx:USDSGD | stocks:^STI,^GSPC | crypto:btc,eth | cur:usd`.

## Parameter format

```
fx:USDSGD,SGDJPY | stocks:D05.SI,^GSPC | crypto:btc,eth | cur:sgd
```

- **Groups** are separated by `|`, and items within a group by commas.
- **Spaces and capitals don't matter**: `FX: usd/sgd` is the same as `fx:USDSGD`.
- **Up to 5 items per group**; extras are dropped. Duplicates are removed.
- **Order matters**: groups appear in the order you list them (left to right on medium, top to bottom on small).
- **`cur:`** sets the currency for **crypto prices only**, e.g. `cur:sgd`. The default is `usd`. Stocks always show in their own market's currency, and FX pairs are rates.
- Anything it can't read is skipped. If nothing valid is left, the defaults are used.

## Ticker conventions

| What | How to write it | Examples |
|------|-----------------|----------|
| FX pair | Two 3-letter codes, with or without `/` | `USDSGD`, `USD/SGD`, `SGDJPY` |
| SGX stock | Code + `.SI` | `D05.SI` (DBS), `O39.SI` (OCBC), `U11.SI` (UOB) |
| ASX stock | Code + `.AX` | `CBA.AX`, `BHP.AX` |
| US stock | Ticker | `AAPL`, `BRK-B` |
| Index | `^` + Yahoo code | `^STI`, `^AXJO` (ASX 200), `^GSPC` (S&P 500), `^DJI`, `^IXIC`, `^N225` |
| Crypto | Symbol or CoinGecko ID | `btc`, `eth`, `sol`, `xrp`, `doge`, `cro`, or an ID like `render-token` |

Stock tickers are Yahoo Finance's. Search for a company on [finance.yahoo.com](https://finance.yahoo.com) to find its ticker.

## What the widget shows

- **Labels:** `USD/SGD`; stocks without their exchange suffix (`D05`); short names for common indices (`S&P 500`, `STI`, `ASX 200`); crypto in capitals (`BTC`).
- **Prices**, with no currency symbols:
  - FX: 4 decimal places, or 2 for pairs quoted in JPY.
  - Stocks and indices: 2 decimal places under 1,000, whole numbers from 1,000, and whole numbers for prices in JPY.
  - Crypto: 2 significant digits under 1, 3 decimals under 10, 2 under 100, whole numbers up to 99,999, then `K`, `M` or `B` (e.g. `102.5K`).
- **▲ green / ▼ red / grey:** stocks and FX compare with the previous close; crypto uses the 24-hour change.
- **closed** under a stock's label when its market is closed. The price is the last close.
- **Dimmed** prices are the last ones saved, shown when a fetch fails. **—** means no price yet.
- **Updated 3:15pm** at the bottom (Singapore time). The widget asks to refresh about every 15 minutes; iOS decides exactly when.
- **↑ update** at the bottom when a newer version is available (see [Updates](#updates)).
- Tapping the widget opens Yahoo Finance.

## Updates

From version 1.1.0, update checks are **on** from the start:

- Once a day, the widget reads a small version file from [github.com/jkfliu/scriptable-widgets](https://github.com/jkfliu/scriptable-widgets). If there's a newer version, the widget shows **↑ update** at the bottom.
- Nothing installs by itself. To update, open Market Prices in Scriptable and choose **Install update**. You'll see the release notes first.
- **Installing means running code downloaded from that GitHub repo on your phone.** Only install updates if you trust it. The script checks that the download looks like a newer Market Prices script before using it.
- The current version is kept as **Market Prices (previous)**, so you can go back to it. If the install fails, your current script isn't changed.

If you'd rather the widget never contacted GitHub, open Scriptable, tap **Market Prices**, and choose **Turn off update checks**. You can turn them back on from the same menu.

Versions before 1.1.0 don't check for updates: download the script again once (see [Install on your phone](#install-on-your-phone)) to get 1.1.0.

## CoinGecko API key (optional)

The widget works without a key. If crypto prices often show dimmed or —, CoinGecko may be rate-limiting your requests. A free demo key from [coingecko.com](https://www.coingecko.com/en/api) helps: run the script in Scriptable, choose **Set CoinGecko API key**, and paste it. It's stored in the iPhone's Keychain and sent only to api.coingecko.com.

## Development

Run from the repo root (see the root README):

| Command | What it does |
|---------|--------------|
| `npm test` | Runs all tests, including this widget's |
| `node scripts/build.js market-prices` | Builds `dist/Market Prices.js` |
| `sh scripts/release.sh market-prices 1.0.1 "Notes"` | Releases a new version: tests, build, secret scan, `version.json` |
| `node widgets/market-prices/scripts/fetch-fixtures.js` | Captures fresh API responses into `test/fixtures/` (Yahoo refuses cloud servers, so run it on a Mac) |

```
widget.json          name, output, version, shared modules, read by the build
src/core.js          pure logic: parameter, parsing, formatting, rows, layout (fully tested)
src/widget.js        Scriptable layer: requests, cache, Keychain, drawing, in-app menu
test/                node:test tests; test/widget.test.js runs the built bundle against Scriptable stand-ins
test/fixtures/       real Yahoo and CoinGecko responses, documented in their README
scripts/fetch-fixtures.js  captures the fixtures
version.json         { version, notes } of the latest release
CHANGELOG.md
```
