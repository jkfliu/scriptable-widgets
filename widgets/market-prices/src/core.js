// Pure logic for the Market Prices widget. No Scriptable APIs here: everything is tested under Node.

// --- Parameter ---
// Format: fx:USDSGD,SGDJPY | stocks:D05.SI,^GSPC | crypto:btc,eth | cur:usd
// Groups are separated by |, items by commas. Spaces and letter case are ignored.

const MAX_ITEMS = 5;
const DEFAULT_CURRENCY = 'usd';
const DEFAULTS = {
  medium: 'fx:USDSGD,SGDAUD,SGDJPY | stocks:^STI,^AXJO,^GSPC | crypto:btc,eth,sol | cur:usd',
  small: 'fx:USDSGD | stocks:^STI,^GSPC | crypto:btc,eth | cur:usd',
};

// How each group's items are written and checked. Items are stored in this case.
const GROUPS = {
  fx: { normalise: (s) => s.toUpperCase(), valid: /^[A-Z]{6}$/ }, // e.g. USDSGD
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

module.exports = {
  parseParameter, defaultParameter, resolveParameter, smallItems, columnsFor, toYahooSymbol, toCoinGeckoId,
};
