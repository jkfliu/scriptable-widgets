# Changelog

## 1.0.0 (2026-11-05)

First release.

- Small and medium home screen widgets showing FX rates, stock and index prices (Yahoo Finance) and crypto prices (CoinGecko).
- Choose what to show with the widget's Parameter, e.g. `fx:USDSGD,SGDJPY | stocks:D05.SI,^GSPC | crypto:btc,eth | cur:sgd`. Sensible defaults for each size when it's empty.
- Medium: one column per group (FX, stocks, crypto), up to 5 rows each, with thin dividers. Small: the first 5 items.
- Each row shows the price and ▲ or ▼: green up, red down, grey flat. Stocks and FX compare with the previous close; crypto uses the 24-hour change.
- A small "closed" marker on stocks whose market is closed.
- If a price can't be fetched, the last good one is shown dimmed, or — if there isn't one.
- "Updated" time at the bottom; refreshes about every 15 minutes; tapping opens Yahoo Finance.
- In the app: small and medium previews, an optional CoinGecko API key (stored in the Keychain), and help on the parameter format.
