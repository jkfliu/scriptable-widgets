const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseParameter, defaultParameter, resolveParameter, smallItems, columnsFor, toYahooSymbol, toCoinGeckoId,
} = require('../src/core.js');

const MEDIUM = 'fx:USDSGD,SGDAUD,SGDJPY | stocks:^STI,^AXJO,^GSPC | crypto:btc,eth,sol | cur:usd';
const SMALL = 'fx:USDSGD | stocks:^STI,^GSPC | crypto:btc,eth | cur:usd';

// Just the { type: items } of a parse, for compact assertions.
const itemsOf = (parsed) => Object.fromEntries(parsed.groups.map((g) => [g.type, g.items]));
const typesOf = (parsed) => parsed.groups.map((g) => g.type);

describe('parseParameter', () => {
  test('parses the example from the plan, keeping groups in the order listed', () => {
    const parsed = parseParameter('fx:USDSGD,SGDAUD,SGDJPY | stocks:D05.SI,CBA.AX,^GSPC | crypto:btc,eth,sol | cur:usd');
    assert.deepEqual(parsed.groups, [
      { type: 'fx', items: ['USDSGD', 'SGDAUD', 'SGDJPY'] },
      { type: 'stocks', items: ['D05.SI', 'CBA.AX', '^GSPC'] },
      { type: 'crypto', items: ['btc', 'eth', 'sol'] },
    ]);
    assert.equal(parsed.currency, 'usd');
    assert.deepEqual(parsed.errors, []);
  });

  test('keeps the order the groups are listed in', () => {
    assert.deepEqual(typesOf(parseParameter('crypto:btc | fx:USDSGD | stocks:D05.SI')), ['crypto', 'fx', 'stocks']);
  });

  test('empty input gives no groups, the default currency and no errors', () => {
    for (const empty of ['', '   ', null, undefined, '|', ' | | ']) {
      assert.deepEqual(parseParameter(empty), { groups: [], currency: 'usd', errors: [] }, `input: ${JSON.stringify(empty)}`);
    }
  });

  test('ignores extra spaces anywhere', () => {
    const parsed = parseParameter('  fx :  USDSGD ,  SGDJPY  |stocks:D05.SI|  crypto : btc  ,eth | cur : sgd ');
    assert.deepEqual(itemsOf(parsed), { fx: ['USDSGD', 'SGDJPY'], stocks: ['D05.SI'], crypto: ['btc', 'eth'] });
    assert.equal(parsed.currency, 'sgd');
    assert.deepEqual(parsed.errors, []);
  });

  test('ignores letter case: FX and stocks become uppercase, crypto and currency lowercase', () => {
    const parsed = parseParameter('FX:usdSgd | Stocks:d05.si,^gspc | CRYPTO:BTC,Eth | CUR:SGD');
    assert.deepEqual(itemsOf(parsed), { fx: ['USDSGD'], stocks: ['D05.SI', '^GSPC'], crypto: ['btc', 'eth'] });
    assert.equal(parsed.currency, 'sgd');
  });

  test('FX pairs can be written with a slash, e.g. USD/SGD, and are stored as USDSGD', () => {
    const parsed = parseParameter('fx:USD/SGD, sgd / jpy,SGDAUD');
    assert.deepEqual(itemsOf(parsed), { fx: ['USDSGD', 'SGDJPY', 'SGDAUD'] });
    assert.deepEqual(parsed.errors, []);
  });

  test('USD/SGD and USDSGD count as the same pair', () => {
    const parsed = parseParameter('fx:USD/SGD,USDSGD,usd/sgd');
    assert.deepEqual(itemsOf(parsed), { fx: ['USDSGD'] });
    assert.deepEqual(parsed.errors, []);
  });

  test('crypto symbols and the currency can be uppercase', () => {
    const parsed = parseParameter('crypto:BTC,ETH,SOL | cur:SGD');
    assert.deepEqual(itemsOf(parsed), { crypto: ['btc', 'eth', 'sol'] });
    assert.equal(parsed.currency, 'sgd');
    assert.deepEqual(parsed.errors, []);
  });

  test('spaces inside an item are ignored too', () => {
    assert.deepEqual(itemsOf(parseParameter('fx:USD SGD | stocks:D05 .SI')), { fx: ['USDSGD'], stocks: ['D05.SI'] });
  });

  for (let n = 1; n <= 4; n++) {
    test(`a group with ${n} item${n > 1 ? 's' : ''} keeps exactly those items`, () => {
      const pairs = ['USDSGD', 'SGDAUD', 'SGDJPY', 'EURSGD'].slice(0, n);
      const coins = ['btc', 'eth', 'sol', 'xrp'].slice(0, n);
      const stocks = ['D05.SI', 'CBA.AX', '^GSPC', 'O39.SI'].slice(0, n);
      const parsed = parseParameter(`fx:${pairs.join(',')} | stocks:${stocks.join(',')} | crypto:${coins.join(',')}`);
      assert.deepEqual(itemsOf(parsed), { fx: pairs, stocks, crypto: coins });
      assert.deepEqual(parsed.errors, []);
    });
  }

  test('caps each group at 5 items: 5 are kept, the 6th is dropped and recorded', () => {
    const five = parseParameter('crypto:btc,eth,sol,xrp,ada');
    assert.deepEqual(itemsOf(five), { crypto: ['btc', 'eth', 'sol', 'xrp', 'ada'] });
    assert.deepEqual(five.errors, []);
    const six = parseParameter('crypto:btc,eth,sol,xrp,ada,doge');
    assert.deepEqual(itemsOf(six), { crypto: ['btc', 'eth', 'sol', 'xrp', 'ada'] });
    assert.equal(six.errors.length, 1);
    assert.match(six.errors[0], /doge/);
  });

  test('removes duplicates, including ones that differ only in case or spacing, before capping', () => {
    const parsed = parseParameter('fx:USDSGD,usdsgd, USD SGD,SGDJPY | crypto:btc,eth,BTC,sol,xrp,ada');
    assert.deepEqual(itemsOf(parsed), { fx: ['USDSGD', 'SGDJPY'], crypto: ['btc', 'eth', 'sol', 'xrp', 'ada'] });
    assert.deepEqual(parsed.errors, []);
  });

  test('a group listed twice is merged into its first position', () => {
    const parsed = parseParameter('fx:USDSGD | crypto:btc | fx:SGDJPY,USDSGD');
    assert.deepEqual(parsed.groups, [
      { type: 'fx', items: ['USDSGD', 'SGDJPY'] },
      { type: 'crypto', items: ['btc'] },
    ]);
  });

  test('skips empty items, e.g. from a trailing or doubled comma, without an error', () => {
    const parsed = parseParameter('fx:USDSGD,,SGDJPY, | crypto:,btc');
    assert.deepEqual(itemsOf(parsed), { fx: ['USDSGD', 'SGDJPY'], crypto: ['btc'] });
    assert.deepEqual(parsed.errors, []);
  });

  test('ignores unknown group names and records them', () => {
    const parsed = parseParameter('fx:USDSGD | bonds:SG10Y | crypto:btc');
    assert.deepEqual(itemsOf(parsed), { fx: ['USDSGD'], crypto: ['btc'] });
    assert.equal(parsed.errors.length, 1);
    assert.match(parsed.errors[0], /bonds/);
  });

  test('ignores parts without a group name and records them', () => {
    const parsed = parseParameter('USDSGD | crypto:btc | :eth');
    assert.deepEqual(itemsOf(parsed), { crypto: ['btc'] });
    assert.equal(parsed.errors.length, 2);
    assert.match(parsed.errors[0], /USDSGD/);
  });

  test('a group with no items is left out and recorded', () => {
    const parsed = parseParameter('fx: | crypto:btc');
    assert.deepEqual(typesOf(parsed), ['crypto']);
    assert.equal(parsed.errors.length, 1);
    assert.match(parsed.errors[0], /fx/);
  });

  test('drops malformed items and records them, keeping the rest of the group', () => {
    const parsed = parseParameter('fx:USDSGD,USDSG,USD/SG,US/DSGD,USD//SGD,USDSGD1 | stocks:D05.SI,D05=X,^ | crypto:btc,bt$c');
    assert.deepEqual(itemsOf(parsed), { fx: ['USDSGD'], stocks: ['D05.SI'], crypto: ['btc'] });
    assert.equal(parsed.errors.length, 8);
    for (const bad of ['USDSG', 'USD/SG', 'US/DSGD', 'USD//SGD', 'USDSGD1', 'D05=X', '^', 'bt$c']) {
      assert.ok(parsed.errors.some((e) => e.includes(bad)), `no error for ${bad}`);
    }
  });

  test('accepts the usual stock ticker shapes', () => {
    const tickers = ['D05.SI', 'CBA.AX', '^GSPC', '^STI', 'BRK-B', '7203.T', 'AAPL'];
    const parsed = parseParameter(`stocks:${tickers.slice(0, 5).join(',')} | stocks:${tickers.slice(5).join(',')}`);
    assert.deepEqual(parsed.errors.filter((e) => !/more than 5/.test(e)), []);
  });

  test('cur: sets the currency; a missing or malformed one keeps usd and is recorded', () => {
    assert.equal(parseParameter('crypto:btc').currency, 'usd');
    assert.equal(parseParameter('crypto:btc | cur:SGD').currency, 'sgd');
    for (const bad of ['cur:', 'cur:usd,sgd', 'cur:us', 'cur:dollars', 'cur:$']) {
      const parsed = parseParameter(`crypto:btc | ${bad}`);
      assert.equal(parsed.currency, 'usd', bad);
      assert.equal(parsed.errors.length, 1, bad);
    }
  });

  test('cur: on its own gives no groups', () => {
    assert.deepEqual(parseParameter('cur:sgd'), { groups: [], currency: 'sgd', errors: [] });
  });

  test('never throws on odd input', () => {
    for (const odd of [':', '::', 'fx::USDSGD', '|||', ',,,', 'fx', 42, {}, 'fx:USDSGD|'.repeat(50)]) {
      assert.doesNotThrow(() => parseParameter(odd), `input: ${String(odd)}`);
    }
  });
});

describe('defaultParameter', () => {
  test('medium and small have their own defaults', () => {
    assert.equal(defaultParameter('medium'), MEDIUM);
    assert.equal(defaultParameter('small'), SMALL);
  });

  test('any other size, or none (running in the app), uses the medium default', () => {
    for (const family of ['large', 'extraLarge', 'accessoryRectangular', undefined, null, '']) {
      assert.equal(defaultParameter(family), MEDIUM, `family: ${family}`);
    }
  });

  test('both defaults parse cleanly', () => {
    assert.deepEqual(parseParameter(MEDIUM).errors, []);
    assert.deepEqual(itemsOf(parseParameter(SMALL)), { fx: ['USDSGD'], stocks: ['^STI', '^GSPC'], crypto: ['btc', 'eth'] });
  });
});

describe('resolveParameter', () => {
  test('uses the parameter when it has at least one valid item', () => {
    assert.deepEqual(itemsOf(resolveParameter('crypto:sol', 'medium')), { crypto: ['sol'] });
  });

  test('an empty parameter uses the default for the size', () => {
    assert.deepEqual(resolveParameter('', 'medium'), parseParameter(MEDIUM));
    assert.deepEqual(resolveParameter(null, 'small'), parseParameter(SMALL));
  });

  test('a parameter with no valid items falls back to the default, keeping its errors', () => {
    const resolved = resolveParameter('bonds:SG10Y | fx:NOPE', 'small');
    assert.deepEqual(resolved.groups, parseParameter(SMALL).groups);
    assert.equal(resolved.errors.length, 2);
  });

  test('a valid cur: still applies when the groups fall back to the default', () => {
    const resolved = resolveParameter('cur:sgd', 'medium');
    assert.deepEqual(resolved.groups, parseParameter(MEDIUM).groups);
    assert.equal(resolved.currency, 'sgd');
  });
});

describe('smallItems', () => {
  test('takes the first 5 items across all groups, in the order listed', () => {
    assert.deepEqual(smallItems(parseParameter(MEDIUM)), [
      { type: 'fx', symbol: 'USDSGD' },
      { type: 'fx', symbol: 'SGDAUD' },
      { type: 'fx', symbol: 'SGDJPY' },
      { type: 'stocks', symbol: '^STI' },
      { type: 'stocks', symbol: '^AXJO' },
    ]);
  });

  test('the small default fills exactly 5 rows', () => {
    assert.equal(smallItems(parseParameter(SMALL)).length, 5);
  });

  test('with fewer than 5 items in total, returns all of them', () => {
    assert.deepEqual(smallItems(parseParameter('crypto:btc | fx:USDSGD')), [
      { type: 'crypto', symbol: 'btc' },
      { type: 'fx', symbol: 'USDSGD' },
    ]);
    assert.deepEqual(smallItems(parseParameter('stocks:D05.SI')), [{ type: 'stocks', symbol: 'D05.SI' }]);
  });

  test('with no groups, returns nothing', () => {
    assert.deepEqual(smallItems(parseParameter('')), []);
  });
});

describe('columnsFor', () => {
  test('returns the groups present, in order', () => {
    assert.deepEqual(columnsFor(parseParameter(MEDIUM)).map((c) => c.type), ['fx', 'stocks', 'crypto']);
    assert.deepEqual(columnsFor(parseParameter('crypto:btc | fx:USDSGD')).map((c) => c.type), ['crypto', 'fx']);
    assert.deepEqual(columnsFor(parseParameter('stocks:D05.SI')).map((c) => c.type), ['stocks']);
  });

  test('each column carries its items', () => {
    assert.deepEqual(columnsFor(parseParameter('crypto:btc,eth')), [{ type: 'crypto', items: ['btc', 'eth'] }]);
  });

  test('with no groups, returns no columns', () => {
    assert.deepEqual(columnsFor(parseParameter('')), []);
  });
});

describe('toYahooSymbol', () => {
  test('FX pairs get =X', () => {
    assert.equal(toYahooSymbol('USDSGD', 'fx'), 'USDSGD=X');
    assert.equal(toYahooSymbol('SGDJPY', 'fx'), 'SGDJPY=X');
  });

  test('stock tickers and indices are left as they are', () => {
    for (const s of ['D05.SI', 'CBA.AX', '^GSPC']) assert.equal(toYahooSymbol(s, 'stocks'), s);
  });

  test('crypto and unknown types have no Yahoo symbol', () => {
    assert.equal(toYahooSymbol('btc', 'crypto'), null);
    assert.equal(toYahooSymbol('USDSGD', 'bonds'), null);
  });
});

describe('toCoinGeckoId', () => {
  test('maps common symbols to CoinGecko IDs', () => {
    assert.equal(toCoinGeckoId('btc'), 'bitcoin');
    assert.equal(toCoinGeckoId('eth'), 'ethereum');
    assert.equal(toCoinGeckoId('sol'), 'solana');
    assert.equal(toCoinGeckoId('xrp'), 'ripple');
    assert.equal(toCoinGeckoId('doge'), 'dogecoin');
  });

  test('ignores case', () => {
    assert.equal(toCoinGeckoId('BTC'), 'bitcoin');
  });

  test('passes unknown symbols and full IDs through, in lowercase', () => {
    assert.equal(toCoinGeckoId('bitcoin'), 'bitcoin');
    assert.equal(toCoinGeckoId('render-token'), 'render-token');
    assert.equal(toCoinGeckoId('PEPE'), 'pepe');
  });

  test('does not map names that happen to be object properties', () => {
    assert.equal(toCoinGeckoId('constructor'), 'constructor');
    assert.equal(toCoinGeckoId('__proto__'), '__proto__');
  });
});
