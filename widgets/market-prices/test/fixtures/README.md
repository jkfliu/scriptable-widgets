# Fixtures

Real responses from Yahoo Finance and CoinGecko, captured on 2026-11-05. `captures.json` lists each file's URL, HTTP status (where known), capture time and how it was captured.

| File | Request | Captured | Notes |
|------|---------|----------|-------|
| `yahoo-D05.SI.json` | `/v8/finance/chart/D05.SI` | 09:41 SGT | SGX stock, **market open** (regular session 09:00–17:00 SGT) |
| `yahoo-GSPC.json` | `/v8/finance/chart/%5EGSPC` | after 05:51 SGT | S&P 500 index, **market closed** (session ended 05:00 SGT). Arrays trimmed |
| `yahoo-USDSGD.json` | `/v8/finance/chart/USDSGD=X` | 09:53 SGT | FX pair, open (FX trades about 24 hours on weekdays). Arrays trimmed |
| `yahoo-invalid.json` | `/v8/finance/chart/NOTAREALTICKER123.SI` | 2026-11-05 | Error response for an unknown symbol |
| `coingecko-usd.json` | `simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true` | 09:21 SGT | |
| `coingecko-sgd.json` | same, `vs_currencies=sgd` | 09:21 SGT | |
| `coingecko-invalid.json` | `simple/price?ids=notarealcoin123&vs_currencies=usd&include_24hr_change=true` | 09:21 SGT | Unknown ID: HTTP 200 with `{}` |

Yahoo base URL: `https://query1.finance.yahoo.com`. CoinGecko base URL: `https://api.coingecko.com/api/v3`.

## How they were captured

- **CoinGecko:** by `scripts/fetch-fixtures.js`, without an API key.
- **Yahoo:** Yahoo answered every request from the Claude Code cloud session with HTTP 429 "Too Many Requests" (it throttles data-centre IPs). So the Yahoo responses were opened in Safari on the iPhone, copied, and pasted into the session. Safari doesn't show the HTTP status, so it's recorded as not known.
- **Trimmed arrays:** in `yahoo-GSPC.json` and `yahoo-USDSGD.json`, the per-minute arrays (`timestamp` and `indicators.quote[0].*`) are cut to their first 3 and last 3 entries, to avoid hand-copying hundreds of numbers. `meta` is exactly as received, and the shape is unchanged. `yahoo-D05.SI.json` is complete.
- To refresh these from a Mac or another normal connection: `node scripts/fetch-fixtures.js` (add `--label=closed` to keep a second set captured while markets are closed). Not yet captured: `CBA.AX` and `SGDJPY=X`.

## Yahoo chart: success shape

```jsonc
{
  "chart": {
    "result": [
      {
        "meta": { /* everything the widget needs: see below */ },
        "timestamp": [1793840400, 1793840460 /* ...one per minute, seconds since 1970 */],
        "indicators": {
          "quote": [{ "open": [], "high": [], "low": [], "close": [], "volume": [] }] // same length as timestamp
        }
      }
    ],
    "error": null
  }
}
```

Without query parameters, the response is `range: "1d"` with `dataGranularity: "1m"`: one entry per minute of the latest session.

### Fields the widget uses (all in `chart.result[0].meta`)

| Need | Field | D05.SI | ^GSPC | USDSGD=X |
|------|-------|--------|-------|----------|
| Current price | `regularMarketPrice` | 70.36 | 7688.62 | 1.277 |
| Previous close | `previousClose` (and `chartPreviousClose`, equal in all three) | 70.78 | 7568.92 | 1.278 |
| Change today, % | `regularMarketChangePercent` | -0.593 | 1.581 | -0.0751 |
| Last trade time | `regularMarketTime` (seconds since 1970, UTC) | 09:41 SGT | 16:51 ET | 09:53 SGT |
| Trading hours | `currentTradingPeriod.regular.start` / `.end` (seconds, UTC) | 09:00–17:00 SGT | 09:30–16:00 ET | 00:00–23:59 GMT |
| Currency | `currency` | SGD | USD | SGD |
| Kind | `instrumentType` | EQUITY | INDEX | CURRENCY |
| Decimal places Yahoo suggests | `priceHint` | 2 | 2 | 4 |

Other `meta` fields seen: `symbol`, `exchangeName`, `fullExchangeName`, `exchangeTimezoneName`, `timezone`, `gmtoffset` (seconds), `firstTradeDate`, `hasPrePostMarketData`, `fulldayPrice`, `fulldayChange`, `fulldayChangePercent`, `fiftyTwoWeekHigh`, `fiftyTwoWeekLow`, `regularMarketDayHigh`, `regularMarketDayLow`, `regularMarketVolume`, `longName`, `shortName`, `scale`, `currentTradingPeriod.pre` / `.post`, `tradingPeriods`, `dataGranularity`, `range`, `validRanges`.

### Things to know

- **Open or closed: compare *now* with `currentTradingPeriod.regular`.** `regularMarketTime` isn't enough: for ^GSPC it is 16:51 ET, after the 16:00 close.
- **After the close, `currentTradingPeriod` still describes the session that just ended.** For ^GSPC, captured after 20:00 ET, it still held that day's pre (04:00–09:30), regular (09:30–16:00) and post (16:00–20:00) periods.
- **FX:** `currency` is the quote currency (SGD for USDSGD). The regular period runs almost 24 hours (00:00–23:59 London time), with zero-length pre and post periods. Volume is always 0.
- **Read `meta`, not the arrays.** The per-minute arrays contain `null` rows (D05.SI at 09:40 SGT; USDSGD near the end), and volume entries can be 0.
- **Key order varies:** `quote` lists its arrays in a different order for each symbol, and USDSGD's trading periods list `end` before `start`.

## Yahoo chart: error shape (unknown symbol)

```json
{ "chart": { "result": null, "error": { "code": "Not Found", "description": "No data found, symbol may be delisted" } } }
```

## CoinGecko simple/price

```jsonc
{
  "bitcoin":  { "usd": 80303,   "usd_24h_change": 4.48940120104541 },
  "ethereum": { "usd": 2411.69, "usd_24h_change": 6.626462586007126 },
  "solana":   { "usd": 95.29,   "usd_24h_change": 3.8917247354641042 }
}
```

- Keyed by CoinGecko ID, then by the lowercase `vs_currencies` code. The price is under `<cur>` and the 24-hour change (in %) under `<cur>_24h_change`.
- The SGD response has the same shape, with `sgd` and `sgd_24h_change`.
- **An unknown ID is not an error:** HTTP 200 with `{}`. The ID is simply missing from the response.
