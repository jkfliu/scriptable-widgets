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

// Crypto: 2 significant digits under 1, whole numbers up to 99,999, then K, M or B with one decimal.
function formatCrypto(value) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs === 0) return '0';
  if (abs < 1) {
    const dp = 1 - Math.floor(Math.log10(abs));
    if (roundTo(abs, dp) < 1) return sign + fixed(abs, dp);
  }
  if (Math.round(abs) < 100000) return sign + fixed(abs, 0);
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

module.exports = {
  parseParameter, defaultParameter, resolveParameter, smallItems, columnsFor, toYahooSymbol, toCoinGeckoId,
  parseYahooChart, parseCoinGecko, direction,
  label, formatPrice, COLUMN_MAX_CHARS,
};
