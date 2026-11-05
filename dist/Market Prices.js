// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: chart-line;

// Time helpers shared by widgets. Pure: callers pass `now` in, nothing reads the clock.

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const SGT_OFFSET = 8 * HOUR; // Singapore is UTC+8 with no daylight saving

const toMs = (t) => (t instanceof Date ? t.getTime() : t);

// True if latestTime is more than maxAgeMinutes before now. A missing or invalid time, or a
// missing or invalid limit, counts as stale. A time in the future is not stale.
function isStale(latestTime, now, maxAgeMinutes) {
  const time = toMs(latestTime);
  if (!Number.isFinite(time)) return true;
  if (typeof maxAgeMinutes !== 'number' || !Number.isFinite(maxAgeMinutes) || maxAgeMinutes < 0) return true;
  return toMs(now) - time > maxAgeMinutes * 60e3;
}

// Singapore wall-clock time as "3:00pm", or null for a missing or invalid time.
function formatSgtTime(time) {
  const ms = toMs(time);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + SGT_OFFSET);
  const h = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${mm}${h < 12 ? 'am' : 'pm'}`;
}

// "Updated 3:00pm", or '' for a missing or invalid time.
function formatUpdated(time) {
  const t = formatSgtTime(time);
  return t ? `Updated ${t}` : '';
}

// Update checker shared by widgets: versions, the version.json manifest, and where to fetch updates.
// Each widget has its own manifest at widgets/<folder>/version.json and its script at dist/<output>
// on the release branch of this repo.


const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const REPO_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const WIDGET_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SCRIPT_PATTERN = /^[^/\\]+\.js$/;
const UPDATE_CHECK_EVERY = DAY;
const SCRIPTABLE_HEADER = '// Variables used by Scriptable.';
const RELEASE_BRANCH = 'main';

const parseVersion = (v) => (typeof v === 'string' && v.match(VERSION_PATTERN)?.slice(1).map(Number)) || null;
const isVersion = (v) => parseVersion(v) !== null;

// The line scripts/build.js writes into the bundle and isPlausibleUpdate looks for.
const versionLine = (version) => `const VERSION = '${version}';`;

// 1 if a is newer, -1 if older, 0 if equal; null if either isn't a plain x.y.z version.
function compareVersions(a, b) {
  const [pa, pb] = [parseVersion(a), parseVersion(b)];
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

// version.json text to { version, notes }; null if it isn't valid.
function parseManifest(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return null;
  }
  if (!json || typeof json !== 'object' || !isVersion(json.version)) return null;
  return { version: json.version, notes: typeof json.notes === 'string' ? json.notes : '' };
}

// At most one check a day. A last check in the future means the clock changed, so check again.
function shouldCheckForUpdate(lastChecked, now) {
  const last = toMs(lastChecked);
  if (!Number.isFinite(last)) return true;
  const elapsed = toMs(now) - last;
  return elapsed < 0 || elapsed >= UPDATE_CHECK_EVERY;
}

// Raw GitHub URLs for a widget's manifest and built script, or null if any part is malformed.
// repo: owner/repo. widget: the folder under widgets/. script: the output filename in dist/.
function updateUrl(repo, widget, script) {
  if (typeof repo !== 'string' || !REPO_PATTERN.test(repo) || repo.includes('..')) return null;
  if (typeof widget !== 'string' || !WIDGET_PATTERN.test(widget)) return null;
  if (typeof script !== 'string' || !SCRIPT_PATTERN.test(script) || script === '.js' || script.startsWith('..')) return null;
  const base = `https://raw.githubusercontent.com/${repo}/${RELEASE_BRANCH}`;
  return {
    manifest: `${base}/widgets/${widget}/version.json`,
    script: `${base}/dist/${encodeURIComponent(script)}`,
  };
}

// Sanity checks on a downloaded script before it replaces the installed one.
function isPlausibleUpdate(source, expectedVersion, currentVersion) {
  const fail = (reason) => ({ ok: false, reason });
  if (typeof source !== 'string' || !source.trim()) return fail('The download was empty.');
  if (!source.startsWith(SCRIPTABLE_HEADER)) return fail("The download isn't a Scriptable script.");
  const newer = compareVersions(expectedVersion, currentVersion);
  if (newer === null) return fail('A version number was malformed.');
  if (newer <= 0) return fail(`${expectedVersion} isn't newer than the installed ${currentVersion}.`);
  if (!source.includes(`\n${versionLine(expectedVersion)}\n`)) {
    return fail(`The download's version doesn't match ${expectedVersion}.`);
  }
  return { ok: true };
}

// Thin wrappers over Scriptable's FileManager and Keychain, shared by widgets.
// They use Scriptable globals at call time, so the tests stand those in.

function localPath(name) {
  const fm = FileManager.local();
  return fm.joinPath(fm.documentsDirectory(), name);
}

// The parsed JSON in a local documents file, or {} if it's missing, malformed or null.
function readJsonFile(name) {
  try {
    return JSON.parse(FileManager.local().readString(localPath(name))) ?? {};
  } catch (e) {
    return {};
  }
}

const writeJsonFile = (name, value) => FileManager.local().writeString(localPath(name), JSON.stringify(value));

const keychainHas = (key) => Keychain.contains(key);
const keychainGet = (key) => (Keychain.contains(key) ? Keychain.get(key) : null);
const keychainSet = (key, value) => Keychain.set(key, value);
function keychainRemove(key) {
  if (Keychain.contains(key)) Keychain.remove(key);
}

// Pure logic for the Market Prices widget. No Scriptable APIs here: everything is tested under Node.
// The build strips the requires below; the shared modules come before this file in the bundle.

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
  ['usdt', 'tether'], ['usdc', 'usd-coin'], ['cro', 'crypto-com-chain'],
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
// FX: 4 decimals (2 if quoted in JPY). Stocks and indices: 2 decimals under 1,000, else whole numbers.
function formatPrice(value, type, symbol, currency) {
  if (finite(value) === null) return '—';
  if (type === 'crypto') return formatCrypto(value);
  if (type === 'fx') {
    const quote = typeof symbol === 'string' && /^[A-Z]{6}$/.test(symbol) ? symbol.slice(3) : currency;
    return fixed(value, quote === 'JPY' ? 2 : 4);
  }
  if (type === 'stocks') {
    // Whole numbers for JPY prices and from 1,000 (including a price that rounds up to it).
    if (currency === 'JPY' || Math.abs(roundTo(value, 2)) >= 1000) return fixed(value, 0);
  }
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

// Content widths in points for a 6.1" iPhone, with the widget's padding taken off.
const CONTENT_WIDTH = { small: 134, medium: 314 };
const DIVIDER_GAP = 4; // space either side of a divider
const DIVIDER_WIDTH = 1;
const LABEL_SHARE = 0.48; // of a column, for the label; the rest is for the price and arrow

// Fixed sizes for a layout, so every label and price in a widget uses one font size and never
// shrinks: 10 pt with three columns, 11 pt otherwise. Columns, gaps and dividers fill the width.
function columnMetrics(family, columnCount) {
  const n = Math.max(1, columnCount | 0);
  const contentWidth = family === 'small' ? CONTENT_WIDTH.small : CONTENT_WIDTH.medium;
  const columnWidth = (contentWidth - (n - 1) * (2 * DIVIDER_GAP + DIVIDER_WIDTH)) / n;
  const fontSize = n >= 3 ? 10 : 11;
  const arrowFontSize = fontSize - 3;
  const labelWidth = Math.round(columnWidth * LABEL_SHARE);
  return {
    contentWidth,
    columnWidth,
    dividerGap: DIVIDER_GAP,
    dividerWidth: DIVIDER_WIDTH,
    fontSize,
    arrowFontSize,
    arrowWidth: arrowFontSize * 0.8 + 1, // the arrow plus the 1 pt before it
    labelWidth,
    priceWidth: columnWidth - labelWidth,
  };
}

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

// --- Update checks ---

// The saved settings file, with defaults: update checks are on unless turned off.
// { updateChecks, lastChecked (epoch ms or null), latest ({ version, notes } or null) }
function readSettings(raw) {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    updateChecks: obj.updateChecks !== false,
    lastChecked: finite(obj.lastChecked),
    latest: obj.latest ? parseManifest(JSON.stringify(obj.latest)) : null,
  };
}

// Whether to fetch version.json now: checks on, and at most once a day.
const updateDue = (settings, now) => settings.updateChecks && shouldCheckForUpdate(settings.lastChecked, now);

// Whether the latest known release is newer than the installed version (never for a dev build).
const updateAvailable = (settings, version) =>
  settings.updateChecks && compareVersions(settings.latest?.version, version) === 1;

// Scriptable layer: requests, Keychain, file cache and drawing. Kept thin: logic lives in core.js.
// Only runs inside Scriptable; test/widget.test.js runs the built bundle against stand-ins.
// The build strips the requires below.

// All set by scripts/build.js from widget.json; the update source is fixed in the published script.
const VERSION = '1.1.0';
const UPDATE_REPO = 'jkfliu/scriptable-widgets';
const UPDATE_WIDGET = 'market-prices';
const UPDATE_SCRIPT = 'Market Prices.js';

const KEYCHAIN_KEY = 'market-prices.coingecko-key';
const CACHE_FILE = 'market-prices-cache.json';
const SETTINGS_FILE = 'market-prices-settings.json';
const BACKUP_NAME = 'Market Prices (previous).js';
const OPEN_URL = 'https://finance.yahoo.com';
// Yahoo rejects requests without a normal browser User-Agent.
const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const TIMEOUT_SECONDS = 10;

const BG = Color.dynamic(new Color('#ffffff'), new Color('#1c1c1e'));
const FG = Color.dynamic(new Color('#111111'), new Color('#f2f2f7'));
const MUTED = Color.dynamic(new Color('#6e6e73'), new Color('#98989d'));
const TONES = {
  up: Color.dynamic(new Color('#1a7f37'), new Color('#3fb950')),
  down: Color.dynamic(new Color('#cf222e'), new Color('#ff6b6b')),
  flat: MUTED,
};
const DIVIDER = Color.dynamic(new Color('#d1d1d6'), new Color('#3a3a3c'));
const UPDATE_COLOUR = new Color('#2e86de');
const DIMMED = 0.5;
const ROW_HEIGHT = 22;

// --- Data ---

// The response body, or null if the request failed. Status codes are left to the parsers,
// which turn error bodies (e.g. Yahoo's "Too Many Requests") into unavailable items.
async function fetchText(url, headers) {
  try {
    const req = new Request(url);
    req.headers = headers;
    req.timeoutInterval = TIMEOUT_SECONDS;
    return await req.loadString();
  } catch (e) {
    console.error(`Market Prices: ${url}: ${e}`);
    return null;
  }
}

// Fetches every Yahoo symbol and the CoinGecko request at the same time, then builds the rows.
async function loadRows(items, currency, now) {
  const plan = planRequests(items, currency);
  const jobs = plan.yahoo.map((r) => [r.url, { 'User-Agent': USER_AGENT }]);
  if (plan.coinGecko) jobs.push([plan.coinGecko.url, coinGeckoHeaders(keychainGet(KEYCHAIN_KEY))]);
  const bodies = await Promise.all(jobs.map(([url, headers]) => fetchText(url, headers)));
  const responses = new Map(jobs.map(([url], i) => [url, bodies[i]]));
  const { rows, cache, updatedAt } = buildRows(items, collectQuotes(plan, responses, now), readJsonFile(CACHE_FILE), now, currency);
  writeJsonFile(CACHE_FILE, cache);
  return { rows, updatedAt };
}

// --- Drawing ---

// Text at a fixed size: one line, never shrunk (too long gets "…").
function addText(stack, text, font, colour, opacity = 1) {
  const t = stack.addText(text);
  t.font = font;
  t.textColor = colour;
  t.textOpacity = opacity;
  t.lineLimit = 1;
  return t;
}

// A fixed-width label slot (with a small "closed" under the label when that market is closed),
// then a fixed-width price slot with the price and arrow pushed right.
function addRow(column, row, m) {
  const line = column.addStack();
  line.layoutHorizontally();
  line.centerAlignContent();
  line.size = new Size(m.columnWidth, ROW_HEIGHT);
  const opacity = row.dimmed ? DIMMED : 1;

  const left = line.addStack();
  left.layoutVertically();
  left.size = new Size(m.labelWidth, ROW_HEIGHT);
  addText(left, row.label, Font.semiboldSystemFont(m.fontSize), FG, opacity);
  if (row.closed) addText(left, 'closed', Font.systemFont(7), MUTED);

  const right = line.addStack();
  right.layoutHorizontally();
  right.centerAlignContent();
  right.size = new Size(m.priceWidth, ROW_HEIGHT);
  right.addSpacer();
  const colour = TONES[row.tone] ?? MUTED;
  addText(right, row.price, Font.mediumSystemFont(m.fontSize), colour, opacity);
  if (row.arrow) {
    right.addSpacer(1);
    addText(right, row.arrow, Font.systemFont(m.arrowFontSize), colour, opacity);
  }
}

function addDivider(stack, m, height) {
  stack.addSpacer(m.dividerGap);
  const line = stack.addStack();
  line.size = new Size(m.dividerWidth, height);
  line.backgroundColor = DIVIDER;
  stack.addSpacer(m.dividerGap);
}

function buildWidget(family, columns, rows, updatedAt, now, update) {
  const w = new ListWidget();
  w.backgroundColor = BG;
  w.url = OPEN_URL;
  w.refreshAfterDate = refreshAfter(now);
  w.setPadding(12, 12, 10, 12);

  const body = w.addStack();
  body.layoutHorizontally();
  body.topAlignContent();
  const m = columnMetrics(family, columns.length);
  const height = Math.max(...columns.map((c) => c.length)) * ROW_HEIGHT;
  let next = 0;
  columns.forEach((items, i) => {
    if (i > 0) addDivider(body, m, height);
    const column = body.addStack();
    column.layoutVertically();
    column.topAlignContent();
    for (let n = 0; n < items.length; n++) addRow(column, rows[next++], m);
  });

  w.addSpacer();
  const footer = w.addStack();
  footer.layoutHorizontally();
  addText(footer, updatedAt === null ? 'No prices yet' : formatUpdated(updatedAt), Font.systemFont(9), MUTED);
  if (update) {
    footer.addSpacer();
    addText(footer, '↑ update', Font.mediumSystemFont(9), UPDATE_COLOUR);
  }
  return w;
}

// Builds the widget. When checkUpdates is set and a check is due, version.json is fetched
// alongside the prices, so the check never delays the refresh.
async function render(family, now, settings, checkUpdates = false) {
  const parsed = resolveParameter(args.widgetParameter, family);
  const { columns } = layoutFor(family, parsed);
  const [, { rows, updatedAt }] = await Promise.all([
    checkUpdates && UPDATE_URLS && updateDue(settings, now) ? checkForUpdate(settings, now) : null,
    loadRows(columns.flat(), parsed.currency, now),
  ]);
  return buildWidget(family, columns, rows, updatedAt, now, showUpdate(settings));
}

// --- Updates (on by default; turned off in the in-app menu) ---

// null in a dev build (no repo set), which turns all update features off.
const UPDATE_URLS = updateUrl(UPDATE_REPO, UPDATE_WIDGET, UPDATE_SCRIPT);

const loadSettings = () => readSettings(readJsonFile(SETTINGS_FILE));
const saveSettings = (settings) => writeJsonFile(SETTINGS_FILE, settings);
const showUpdate = (settings) => Boolean(UPDATE_URLS) && updateAvailable(settings, VERSION);

// The response body as text; throws on a non-200 status.
async function loadText(url, timeout) {
  const req = new Request(url);
  req.timeoutInterval = timeout;
  const text = await req.loadString();
  if (req.response.statusCode !== 200) throw new Error(`HTTP ${req.response.statusCode}`);
  return text;
}

// Fetches version.json and records it. Only reads the manifest: nothing is installed here.
async function checkForUpdate(settings, now) {
  settings.lastChecked = now; // even on failure, so a broken network doesn't mean a check every refresh
  try {
    const manifest = parseManifest(await loadText(UPDATE_URLS.manifest, 10));
    if (manifest) settings.latest = manifest;
  } catch (e) {
    console.error(`Market Prices update check: ${e}`);
  }
  saveSettings(settings);
}

// The FileManager that owns a path: iCloud if it's in Scriptable's iCloud folder, else local.
function fileManagerFor(path) {
  try {
    const icloud = FileManager.iCloud();
    if (path.startsWith(icloud.documentsDirectory())) return icloud;
  } catch (e) {
    // iCloud is off for Scriptable, so the script must be stored locally.
  }
  return FileManager.local();
}

// Downloads the new script, checks it, backs up the current one, then overwrites it.
// Throws with a readable message on any failure, leaving the current script untouched.
async function installUpdate(latest) {
  let source;
  try {
    source = await loadText(UPDATE_URLS.script, 30);
  } catch (e) {
    throw new Error(`Download failed (${e.message ?? e}).`);
  }
  const check = isPlausibleUpdate(source, latest.version, VERSION);
  if (!check.ok) throw new Error(check.reason);
  const self = module.filename;
  const fm = fileManagerFor(self);
  fm.writeString(self.replace(/[^/]+$/, BACKUP_NAME), fm.readString(self));
  fm.writeString(self, source);
}

// --- In-app menu ---

async function promptForKey() {
  const a = new Alert();
  a.title = 'CoinGecko API key';
  a.message = 'Optional: a free demo key avoids CoinGecko\'s rate limits. '
    + 'Stored in this device\'s Keychain and sent only to api.coingecko.com.';
  a.addSecureTextField('API key', '');
  a.addAction('Save');
  a.addCancelAction('Cancel');
  if ((await a.present()) !== 0) return;
  const key = a.textFieldValue(0).trim();
  if (key) keychainSet(KEYCHAIN_KEY, key);
}

async function showHelp() {
  const a = new Alert();
  a.title = 'Parameter format';
  a.message = HELP_TEXT;
  a.addAction('OK');
  await a.present();
}

async function showMessage(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction('OK');
  await a.present();
}

// true if the user taps `ok`.
async function confirm(title, message, ok, cancel = 'Cancel') {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction(ok);
  a.addCancelAction(cancel);
  return (await a.present()) === 0;
}

async function offerUpdate(settings) {
  const { version, notes } = settings.latest;
  const message = `${notes || 'No release notes.'}\n\nInstalled: ${VERSION}. The current script is kept as "${BACKUP_NAME}".`;
  if (!(await confirm(`Update to ${version}?`, message, 'Install update', 'Not now'))) return;
  try {
    await installUpdate(settings.latest);
    await showMessage('Update installed', `Market Prices ${version} is installed. Run the script again to use it.`);
  } catch (e) {
    await showMessage('Update not installed', `${e.message ?? e}\n\nYour current script hasn't changed.`);
  }
}

async function toggleUpdateChecks(settings, now) {
  if (settings.updateChecks) {
    settings.updateChecks = false;
    saveSettings(settings);
    return;
  }
  const message = `Once a day, Market Prices will look for a new version at github.com/${UPDATE_REPO}. `
    + 'Nothing installs by itself. If you tap Install, the new script downloaded from that repo '
    + 'replaces this one and runs on your phone.';
  if (!(await confirm('Turn on update checks?', message, 'Turn on'))) return;
  settings.updateChecks = true;
  await checkForUpdate(settings, now);
}

async function runInApp(now) {
  const settings = loadSettings();
  for (;;) {
    const hasKey = keychainHas(KEYCHAIN_KEY);
    const update = showUpdate(settings);
    const menu = new Alert();
    menu.title = 'Market Prices';
    menu.message = [
      `Version ${VERSION}${update ? ` (${settings.latest.version} available)` : ''}`,
      `CoinGecko API key: ${hasKey ? 'set' : 'not set'}`,
      ...(UPDATE_URLS ? [`Update checks: ${settings.updateChecks ? 'on' : 'off'}`] : []),
    ].join('\n');
    // [title, action, destructive]
    const actions = [
      ...(update ? [[`Install update ${settings.latest.version}`, () => offerUpdate(settings)]] : []),
      ['Preview small', async () => (await render('small', now, settings)).presentSmall()],
      ['Preview medium', async () => (await render('medium', now, settings)).presentMedium()],
      [hasKey ? 'Change CoinGecko API key' : 'Set CoinGecko API key', promptForKey],
      ...(hasKey ? [['Clear CoinGecko API key', () => keychainRemove(KEYCHAIN_KEY), true]] : []),
      ['Help', showHelp],
      ...(UPDATE_URLS ? [[settings.updateChecks ? 'Turn off update checks' : 'Turn on update checks',
        () => toggleUpdateChecks(settings, now)]] : []),
    ];
    for (const [title, , destructive] of actions) {
      if (destructive) menu.addDestructiveAction(title);
      else menu.addAction(title);
    }
    menu.addCancelAction('Done');
    const choice = await menu.presentSheet();
    if (choice === -1) return;
    await actions[choice][1]();
  }
}

// --- Entry point ---

const now = Date.now();
if (config.runsInWidget) {
  Script.setWidget(await render(config.widgetFamily, now, loadSettings(), true));
} else {
  await runInApp(now);
}
Script.complete();
