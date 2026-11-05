#!/usr/bin/env node
// Downloads real Yahoo Finance and CoinGecko responses into test/fixtures/ for the parser tests.
// Run by hand; tests never touch the network. Bodies are saved exactly as received, and
// captures.json records each request's URL, HTTP status and capture time.
// Usage: node scripts/fetch-fixtures.js [--label=closed]
//   --label adds a suffix to the Yahoo filenames, e.g. yahoo-GSPC.closed.json, so captures
//   taken while a market is open and while it's closed can sit side by side.

const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'test', 'fixtures');
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';
const COINGECKO = 'https://api.coingecko.com/api/v3/simple/price';
// Yahoo rejects requests without a normal browser User-Agent.
const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const YAHOO_SYMBOLS = ['D05.SI', 'CBA.AX', '^GSPC', 'USDSGD=X', 'SGDJPY=X'];
const YAHOO_INVALID = 'NOTAREALTICKER123.SI';
const COINS = ['bitcoin', 'ethereum', 'solana'];
const COIN_CURRENCIES = ['usd', 'sgd'];
const COIN_INVALID = 'notarealcoin123';

// Fixture filename for a source and symbol: ^ and =X dropped, unsafe characters removed.
function fixtureName(source, symbol, label = '') {
  if (!source) throw new Error('fixtureName: needs a source');
  const clean = (s) => String(s).replace(/[^A-Za-z0-9.-]/g, '').replace(/^\.+/, '');
  const name = clean(String(symbol ?? '').replace(/^\^/, '').replace(/=X$/, ''));
  if (!name) throw new Error(`fixtureName: bad symbol ${symbol}`);
  const suffix = label ? `.${clean(label)}` : '';
  return `${source}-${name}${suffix}.json`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// { status, body } for a URL. Retries 429s with a growing wait; other statuses are returned as-is,
// since the error responses are wanted too.
async function get(url, attempt = 1) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (res.status === 429 && attempt <= 4) {
    const wait = 15e3 * attempt;
    console.log(`429 from ${new URL(url).host}, retrying in ${wait / 1000}s`);
    await sleep(wait);
    return get(url, attempt + 1);
  }
  return { status: res.status, body: await res.text() };
}

// Saves a JSON body pretty-printed, or the raw text if it isn't JSON.
function save(name, { status, body }, url, captures) {
  let text = body;
  try {
    text = `${JSON.stringify(JSON.parse(body), null, 2)}\n`;
  } catch (e) {
    // not JSON, e.g. an HTML error page: keep it as received
  }
  fs.writeFileSync(path.join(OUT, name), text);
  captures[name] = { url, status, capturedAt: new Date().toISOString() };
  console.log(`saved ${name} (HTTP ${status})`);
}

async function main(argv) {
  const label = argv.find((a) => a.startsWith('--label='))?.slice('--label='.length) ?? '';
  fs.mkdirSync(OUT, { recursive: true });
  const capturesFile = path.join(OUT, 'captures.json');
  const captures = fs.existsSync(capturesFile) ? JSON.parse(fs.readFileSync(capturesFile, 'utf8')) : {};
  const failures = [];

  for (const symbol of [...YAHOO_SYMBOLS, YAHOO_INVALID]) {
    const url = `${YAHOO}/${encodeURIComponent(symbol)}`;
    const result = await get(url);
    const name = symbol === YAHOO_INVALID ? fixtureName('yahoo', 'invalid', label) : fixtureName('yahoo', symbol, label);
    if (result.status === 429) failures.push(`${symbol}: still HTTP 429 after retries`);
    else save(name, result, url, captures);
    await sleep(1500);
  }

  for (const cur of COIN_CURRENCIES) {
    const url = `${COINGECKO}?ids=${COINS.join(',')}&vs_currencies=${cur}&include_24hr_change=true`;
    save(fixtureName('coingecko', cur), await get(url), url, captures);
  }
  const badUrl = `${COINGECKO}?ids=${COIN_INVALID}&vs_currencies=usd&include_24hr_change=true`;
  save(fixtureName('coingecko', 'invalid'), await get(badUrl), badUrl, captures);

  const sorted = Object.fromEntries(Object.entries(captures).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(capturesFile, `${JSON.stringify(sorted, null, 2)}\n`);
  if (failures.length) {
    console.error(`Not saved:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { fixtureName };
