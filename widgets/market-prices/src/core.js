// Pure logic for the Market Prices widget. No Scriptable APIs here: everything is tested under Node.
// The build strips the require below; shared/time.js comes before this file in the bundle.
const { toMs } = require('../../../shared/time.js');

// --- Parameter ---
// Format: fx:USDSGD,SGD/JPY | stocks:D05.SI,^GSPC | crypto:btc,eth | cur:usd
// Groups are separated by |, items by commas. Spaces and letter case are ignored.

const MAX_ITEMS = 5;
const DEFAULT_CURRENCY = 'usd';
const DEFAULTS = {
  medium: 'fx:USDSGD,SGDAUD,SGDJPY | stocks:^STI,^AXJO,^GSPC | crypto:btc,eth,sol | cur:usd',
  small: 'fx:USDSGD | stocks:^STI,^GSPC | crypto:btc,eth | cur:usd',
};

// How each group's items are written and checked. Items are stored in this case.
const GROUPS = {
  // e.g. USDSGD, or USD/SGD, which is stored as USDSGD
  fx: { normalise: (s) => s.toUpperCase().replace(/^([A-Z]{3})\/([A-Z]{3})$/, '$1$2'), valid: /^[A-Z]{6}$/ },
  stocks: { normalise: (s) => s.toUpperCase(), valid: /^\^?[A-Z0-9][A-Z0-9.-]{0,19}$/ }, // D05.SI, ^GSPC, BRK-B
  crypto: { normalise: (s) => s.toLowerCase(), valid: /^[a-z0-9][a-z0-9-]{0,49}$/ }, // btc, or a CoinGecko ID
};
const CURRENCY = /^[a-z]{3,5}$/;

const stripSpaces = (s) => s.replace(/\s+/g, '');

// The parse plus whether a valid cur: was given, which resolveParameter needs.
function parse(param) {
  const groups = [];
  const errors = [];
  let currency = DEFAULT_CURRENCY;
  let currencyGiven = false;
  const text = typeof param === 'string' ? param : '';

  for (const rawPart of text.split('|')) {
    const part = rawPart.trim();
    if (!part) continue;
    const colon = part.indexOf(':');
    const name = colon === -1 ? '' : stripSpaces(part.slice(0, colon)).toLowerCase();
    if (!name) {
      errors.push(`"${part}" has no group name (expected e.g. fx:USDSGD)`);
      continue;
    }
    const items = part.slice(colon + 1).split(',').map(stripSpaces).filter(Boolean);

    if (name === 'cur') {
      const cur = items.length === 1 ? items[0].toLowerCase() : '';
      if (CURRENCY.test(cur)) {
        currency = cur;
        currencyGiven = true;
      } else {
        errors.push(`"${part}" is not a currency (expected e.g. cur:usd)`);
      }
      continue;
    }

    const spec = GROUPS[name];
    if (!spec) {
      errors.push(`unknown group "${name}" (expected fx, stocks, crypto or cur)`);
      continue;
    }
    if (!items.length) {
      errors.push(`${name}: has no items`);
      continue;
    }

    let group = groups.find((g) => g.type === name);
    for (const raw of items) {
      const item = spec.normalise(raw);
      if (!spec.valid.test(item)) {
        errors.push(`${name}: "${raw}" is not valid`);
        continue;
      }
      if (group?.items.includes(item)) continue;
      if (!group) {
        group = { type: name, items: [] };
        groups.push(group);
      }
      if (group.items.length >= MAX_ITEMS) {
        errors.push(`${name}: more than ${MAX_ITEMS} items, dropped "${item}"`);
        continue;
      }
      group.items.push(item);
    }
  }
  return { groups, currency, errors, currencyGiven };
}

// { groups: [{ type, items }] in the order listed, currency, errors }.
function parseParameter(param) {
  const { groups, currency, errors } = parse(param);
  return { groups, currency, errors };
}

// The default parameter string for a widget size. Sizes without their own default use medium's.
function defaultParameter(family) {
  return DEFAULTS[family === 'small' ? 'small' : 'medium'];
}

// The parse to show: the parameter's, or the size's default when it has no valid items.
// Errors from the parameter are kept, and a valid cur: still applies.
function resolveParameter(param, family) {
  const parsed = parse(param);
  if (parsed.groups.length) return parseParameter(param);
  const fallback = parseParameter(defaultParameter(family));
  return {
    groups: fallback.groups,
    currency: parsed.currencyGiven ? parsed.currency : fallback.currency,
    errors: parsed.errors,
  };
}

// The first 5 items across all groups, in the order listed, as [{ type, symbol }].
function smallItems(parsed) {
  return parsed.groups.flatMap((g) => g.items.map((symbol) => ({ type: g.type, symbol }))).slice(0, MAX_ITEMS);
}

// One column per group present, in order, as [{ type, items }].
function columnsFor(parsed) {
  return parsed.groups.filter((g) => g.items.length).map((g) => ({ type: g.type, items: [...g.items] }));
}

// Yahoo Finance symbol for an FX pair or stock; null for crypto and unknown types.
function toYahooSymbol(item, type) {
  if (type === 'fx') return `${item}=X`;
  if (type === 'stocks') return item;
  return null;
}

// Common crypto symbols to CoinGecko IDs. Anything else is passed through as an ID.
const COINGECKO_IDS = new Map([
  ['btc', 'bitcoin'], ['eth', 'ethereum'], ['sol', 'solana'], ['xrp', 'ripple'], ['bnb', 'binancecoin'],
  ['ada', 'cardano'], ['doge', 'dogecoin'], ['trx', 'tron'], ['dot', 'polkadot'], ['ltc', 'litecoin'],
  ['link', 'chainlink'], ['avax', 'avalanche-2'], ['bch', 'bitcoin-cash'], ['xlm', 'stellar'],
  ['atom', 'cosmos'], ['uni', 'uniswap'], ['shib', 'shiba-inu'], ['ton', 'the-open-network'],
  ['usdt', 'tether'], ['usdc', 'usd-coin'],
]);

function toCoinGeckoId(symbol) {
  const s = String(symbol ?? '').toLowerCase();
  return COINGECKO_IDS.get(s) ?? s;
}

// --- Responses ---
// Shapes are documented in test/fixtures/README.md. Anything missing or malformed gives an
// unavailable item, { available: false, reason }, never a throw.

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const has = (obj, key) => obj !== null && typeof obj === 'object' && Object.hasOwn(obj, key);
const unavailable = (reason) => ({ available: false, reason });

// The parsed value of a response given as JSON text or already parsed; { error } if the text isn't JSON.
function readResponse(json) {
  if (typeof json !== 'string') return { data: json };
  try {
    return { data: JSON.parse(json) };
  } catch (e) {
    return { error: 'The response was not valid JSON.' };
  }
}

// One Yahoo chart response to { available, price, previousClose, time, marketOpen, currency }.
// time is the last trade in epoch ms. marketOpen compares now with the regular session
// [start, end); it is null when the session or now is unknown.
function parseYahooChart(json, now) {
  const { data, error } = readResponse(json);
  if (error) return unavailable(error);
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta !== 'object') {
    const description = data?.chart?.error?.description;
    return unavailable(typeof description === 'string' ? description : 'The response had no data.');
  }
  const price = finite(meta.regularMarketPrice);
  if (price === null) return unavailable('The response had no price.');

  const time = finite(meta.regularMarketTime);
  const regular = meta.currentTradingPeriod?.regular;
  const [start, end, nowMs] = [finite(regular?.start), finite(regular?.end), finite(toMs(now))];
  const marketOpen = start === null || end === null || nowMs === null ? null : nowMs >= start * 1000 && nowMs < end * 1000;

  return {
    available: true,
    price,
    previousClose: finite(meta.previousClose) ?? finite(meta.chartPreviousClose),
    time: time === null ? null : time * 1000,
    marketOpen,
    currency: typeof meta.currency === 'string' && meta.currency ? meta.currency : null,
  };
}

// A CoinGecko simple/price response to a Map of ID to { available, price, change24h },
// with one entry per requested ID, in order. change24h is the 24-hour change in %, or null.
function parseCoinGecko(json, ids, currency) {
  const { data } = readResponse(json);
  const body = data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  const cur = typeof currency === 'string' ? currency.toLowerCase() : '';
  const result = new Map();
  for (const id of ids ?? []) {
    if (result.has(id)) continue;
    const entry = has(body, id) ? body[id] : null;
    const price = cur && has(entry, cur) ? finite(entry[cur]) : null;
    if (price === null) {
      result.set(id, unavailable(entry ? `No ${cur || 'currency'} price for ${id}.` : `No data for ${id}.`));
      continue;
    }
    const changeKey = `${cur}_24h_change`;
    result.set(id, { available: true, price, change24h: has(entry, changeKey) ? finite(entry[changeKey]) : null });
  }
  return result;
}

// 'up', 'down' or 'flat'. Crypto items (which carry change24h) use the 24-hour change;
// FX and stocks compare the price with the previous close. Unavailable or incomplete items are flat.
function direction(item) {
  if (!item || typeof item !== 'object' || item.available !== true) return 'flat';
  let delta = null;
  if (has(item, 'change24h')) {
    delta = finite(item.change24h);
  } else {
    const [price, previous] = [finite(item.price), finite(item.previousClose)];
    if (price !== null && previous !== null) delta = price - previous;
  }
  if (delta === null || delta === 0) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

// --- Labels and formatting ---

// Rows (label, space, price, arrow) for typical items fit in this many characters, a first
// estimate for a one-third-width column of the medium widget. To be checked on the phone.
const COLUMN_MAX_CHARS = 18;

// Short names for common indices. Others just lose their ^.
const INDEX_NAMES = new Map([
  ['^GSPC', 'S&P 500'], ['^STI', 'STI'], ['^AXJO', 'ASX 200'],
  ['^DJI', 'Dow'], ['^IXIC', 'Nasdaq'], ['^N225', 'Nikkei'],
]);

// The text for an item's label: USD/SGD, D05, S&P 500, BTC.
function label(item) {
  const symbol = typeof item?.symbol === 'string' ? item.symbol : '';
  if (item?.type === 'fx') return /^[A-Z]{6}$/.test(symbol) ? `${symbol.slice(0, 3)}/${symbol.slice(3)}` : symbol;
  if (item?.type === 'stocks') {
    if (symbol.startsWith('^')) return INDEX_NAMES.get(symbol) ?? symbol.slice(1);
    return symbol.replace(/\.[A-Z]{1,4}$/, '');
  }
  if (item?.type === 'crypto') return symbol.toUpperCase();
  return symbol;
}

// Rounds half away from zero at dp decimal places, avoiding binary float surprises (1.005 -> 1.01).
function roundTo(value, dp) {
  const abs = Math.abs(value);
  const text = String(abs);
  const rounded = text.includes('e')
    ? Math.round(abs * 10 ** dp) / 10 ** dp
    : Number(`${Math.round(Number(`${text}e${dp}`))}e-${dp}`);
  return rounded === 0 ? 0 : Math.sign(value) * rounded;
}

// A number with exactly dp decimals and comma thousands separators, whatever the phone's region.
function fixed(value, dp) {
  const rounded = roundTo(value, dp);
  const [whole, fraction] = Math.abs(rounded).toFixed(dp).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${rounded < 0 ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

// Crypto bands: [upper limit, decimal places for a value in the band]. Under 1, 2 significant digits.
const CRYPTO_BANDS = [
  [1, (v) => 1 - Math.floor(Math.log10(v))],
  [10, () => 3],
  [100, () => 2],
  [100000, () => 0],
];

// Crypto: 2 significant digits under 1, 3 decimals under 10, 2 under 100, whole numbers up to
// 99,999, then K, M or B with one decimal. A value that rounds up to a band's limit uses the next band.
function formatCrypto(value) {
  const sign = value < 0 ? '-' : '';
  let abs = Math.abs(value);
  if (abs === 0) return '0';
  for (const [limit, places] of CRYPTO_BANDS) {
    if (abs >= limit) continue;
    const dp = places(abs);
    if (roundTo(abs, dp) < limit) return sign + fixed(abs, dp);
    abs = limit;
  }
  const units = [['K', 1e3], ['M', 1e6], ['B', 1e9]];
  for (let i = 0; i < units.length; i++) {
    const [unit, size] = units[i];
    const scaled = roundTo(abs / size, 1);
    if (scaled < 1000 || i === units.length - 1) return `${sign}${fixed(scaled, Number.isInteger(scaled) ? 0 : 1)}${unit}`;
  }
  return '';
}

// The price text for a row, with no currency symbol or code. — when there is no number.
function formatPrice(value, type, symbol, currency) {
  if (finite(value) === null) return '—';
  if (type === 'crypto') return formatCrypto(value);
  if (type === 'fx') {
    const quote = typeof symbol === 'string' && /^[A-Z]{6}$/.test(symbol) ? symbol.slice(3) : currency;
    return fixed(value, quote === 'JPY' ? 2 : 4);
  }
  if (type === 'stocks' && currency === 'JPY') return fixed(value, 0);
  return fixed(value, 2);
}

// --- Requests, rows and layout (used by widget.js) ---

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const COINGECKO_PRICE = 'https://api.coingecko.com/api/v3/simple/price';
const REFRESH_MINUTES = 15;
const CACHE_MAX_AGE_DAYS = 7;
const ARROWS = { up: '▲', down: '▼', flat: '' };

const yahooUrl = (symbol) => `${YAHOO_CHART}${encodeURIComponent(symbol)}`;
const coinGeckoUrl = (ids, currency) =>
  `${COINGECKO_PRICE}?ids=${ids.map(encodeURIComponent).join(',')}&vs_currencies=${String(currency).toLowerCase()}&include_24hr_change=true`;

// Request headers for CoinGecko: the optional demo API key, only when one is set.
function coinGeckoHeaders(key) {
  return typeof key === 'string' && key.trim() ? { 'x-cg-demo-api-key': key.trim() } : {};
}

// Cache and quote key for an item. Crypto prices depend on the currency, so it is part of the key.
const itemKey = (item, currency) =>
  (item.type === 'crypto' ? `crypto:${item.symbol}:${currency}` : `${item.type}:${item.symbol}`);

// What to fetch for the items: one Yahoo request per FX pair or stock, and one CoinGecko request
// for all crypto (null if there is none). Duplicates are requested once.
function planRequests(items, currency) {
  const yahoo = [];
  const keys = new Map();
  for (const item of items) {
    const key = itemKey(item, currency);
    if (item.type === 'crypto') {
      keys.set(key, toCoinGeckoId(item.symbol));
    } else if (!yahoo.some((r) => r.key === key)) {
      yahoo.push({ key, url: yahooUrl(toYahooSymbol(item.symbol, item.type)) });
    }
  }
  const ids = [...new Set(keys.values())];
  return { yahoo, coinGecko: ids.length ? { ids, url: coinGeckoUrl(ids, currency), keys } : null };
}

// Quotes by item key from the responses (URL to body text, or null if the request failed).
function collectQuotes(plan, responses, now) {
  const quotes = new Map();
  const failed = unavailable('The request failed.');
  for (const { key, url } of plan.yahoo) {
    const body = responses.get(url);
    quotes.set(key, body == null ? failed : parseYahooChart(body, now));
  }
  if (plan.coinGecko) {
    const { ids, url, keys } = plan.coinGecko;
    const body = responses.get(url);
    const currency = [...keys.keys()][0].split(':').pop();
    const coins = body == null ? new Map() : parseCoinGecko(body, ids, currency);
    for (const [key, id] of keys) quotes.set(key, coins.get(id) ?? failed);
  }
  return quotes;
}

const usableQuote = (q) => q !== null && typeof q === 'object' && q.available === true && finite(q.price) !== null;

// The cache without malformed entries or ones older than CACHE_MAX_AGE_DAYS.
function cleanCache(cache, nowMs) {
  const clean = {};
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return clean;
  for (const [key, entry] of Object.entries(cache)) {
    const at = finite(entry?.fetchedAt);
    if (at !== null && usableQuote(entry) && nowMs - at <= CACHE_MAX_AGE_DAYS * 24 * 3600e3) clean[key] = entry;
  }
  return clean;
}

// Rows to draw, the updated cache, and when the newest value shown was fetched (null if none).
// A row is { key, label, price, arrow, tone, dimmed, closed }. Fresh quotes are saved to the cache;
// when a quote is unavailable, the saved value is shown dimmed, or — if there is none.
function buildRows(items, quotes, cache, now, currency) {
  const nowMs = toMs(now);
  const next = cleanCache(cache, nowMs);
  let updatedAt = null;
  const rows = items.map((item) => {
    const key = itemKey(item, currency);
    const base = { key, label: label(item) };
    const quote = quotes.get(key);
    const fresh = usableQuote(quote);
    if (fresh) next[key] = { ...quote, fetchedAt: nowMs };
    const shown = fresh ? quote : next[key];
    if (!shown) return { ...base, price: '—', arrow: '', tone: 'flat', dimmed: false, closed: false };
    updatedAt = Math.max(updatedAt ?? -Infinity, fresh ? nowMs : shown.fetchedAt);
    const tone = direction(shown);
    return {
      ...base,
      price: formatPrice(shown.price, item.type, item.symbol, item.type === 'crypto' ? currency : shown.currency),
      arrow: ARROWS[tone],
      tone,
      dimmed: !fresh,
      closed: fresh && item.type === 'stocks' && shown.marketOpen === false,
    };
  });
  return { rows, cache: next, updatedAt };
}

// Columns of { type, symbol } items: one column for small, one per group otherwise.
function layoutFor(family, parsed) {
  if (family === 'small') return { columns: [smallItems(parsed)] };
  return { columns: columnsFor(parsed).map((c) => c.items.map((symbol) => ({ type: c.type, symbol }))) };
}

const refreshAfter = (now) => new Date(toMs(now) + REFRESH_MINUTES * 60e3);

const HELP_TEXT = [
  'Set the widget\'s Parameter to choose what it shows, e.g.',
  'fx:USDSGD,SGDJPY | stocks:D05.SI,^GSPC | crypto:btc,eth | cur:sgd',
  '',
  'Groups are separated by |, and items by commas. Spaces and capitals don\'t matter. Up to 5 items per group.',
  '',
  'fx: currency pairs, e.g. USDSGD or USD/SGD.',
  'stocks: Yahoo tickers. .SI for SGX (D05.SI), .AX for ASX (CBA.AX), ^ for indices (^STI, ^GSPC, ^AXJO).',
  'crypto: symbols (btc, eth, sol) or CoinGecko IDs.',
  'cur: the currency for crypto prices only, e.g. cur:sgd. Default usd.',
  '',
  'Medium widgets show one column per group; small widgets show the first 5 items.',
  '',
  'With no Parameter, medium shows:',
  DEFAULTS.medium,
  'and small shows:',
  DEFAULTS.small,
].join('\n');

module.exports = {
  parseParameter, defaultParameter, resolveParameter, smallItems, columnsFor, toYahooSymbol, toCoinGeckoId,
  parseYahooChart, parseCoinGecko, direction,
  label, formatPrice, COLUMN_MAX_CHARS,
  yahooUrl, coinGeckoUrl, coinGeckoHeaders, itemKey, planRequests, collectQuotes, buildRows,
  layoutFor, refreshAfter, HELP_TEXT, CACHE_MAX_AGE_DAYS,
};
