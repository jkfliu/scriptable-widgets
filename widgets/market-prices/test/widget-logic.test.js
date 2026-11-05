const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  yahooUrl, coinGeckoUrl, coinGeckoHeaders, itemKey, planRequests, collectQuotes, buildRows,
  layoutFor, refreshAfter, parseParameter, HELP_TEXT, CACHE_MAX_AGE_DAYS,
} = require('../src/core.js');

const text = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const sec = (s) => s * 1000;
const NOW = sec(1793844887); // just after the Yahoo fixtures were copied (10:14 SGT)
const DAY = 24 * 3600e3;

const ITEMS = [
  { type: 'fx', symbol: 'USDSGD' },
  { type: 'stocks', symbol: 'D05.SI' },
  { type: 'stocks', symbol: '^GSPC' },
  { type: 'crypto', symbol: 'btc' },
  { type: 'crypto', symbol: 'eth' },
];

// Responses by URL, as widget.js hands them over: the body text, or null if the request failed.
const RESPONSES = new Map([
  [yahooUrl('USDSGD=X'), text('yahoo-USDSGD.json')],
  [yahooUrl('D05.SI'), text('yahoo-D05.SI.json')],
  [yahooUrl('^GSPC'), text('yahoo-GSPC.json')],
  [coinGeckoUrl(['bitcoin', 'ethereum'], 'usd'), text('coingecko-usd.json')],
]);

describe('URLs and headers', () => {
  test('yahooUrl is the chart URL the fixtures came from', () => {
    assert.equal(yahooUrl('D05.SI'), 'https://query1.finance.yahoo.com/v8/finance/chart/D05.SI');
    assert.equal(yahooUrl('^GSPC'), 'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC');
    assert.equal(yahooUrl('USDSGD=X'), 'https://query1.finance.yahoo.com/v8/finance/chart/USDSGD%3DX');
  });

  test('coinGeckoUrl matches the fixture requests', () => {
    assert.equal(
      coinGeckoUrl(['bitcoin', 'ethereum', 'solana'], 'usd'),
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true',
    );
    assert.match(coinGeckoUrl(['bitcoin'], 'SGD'), /vs_currencies=sgd&/);
  });

  test('the CoinGecko key header is sent only when there is a key', () => {
    assert.deepEqual(coinGeckoHeaders('abc'), { 'x-cg-demo-api-key': 'abc' });
    for (const none of [null, undefined, '', '   ']) assert.deepEqual(coinGeckoHeaders(none), {});
  });
});

describe('itemKey and planRequests', () => {
  test('keys are type and symbol; crypto keys include the currency', () => {
    assert.equal(itemKey({ type: 'fx', symbol: 'USDSGD' }, 'usd'), 'fx:USDSGD');
    assert.equal(itemKey({ type: 'stocks', symbol: 'D05.SI' }, 'sgd'), 'stocks:D05.SI');
    assert.equal(itemKey({ type: 'crypto', symbol: 'btc' }, 'usd'), 'crypto:btc:usd');
    assert.equal(itemKey({ type: 'crypto', symbol: 'btc' }, 'sgd'), 'crypto:btc:sgd');
  });

  test('one Yahoo request per FX pair or stock, and one CoinGecko request for all crypto', () => {
    const plan = planRequests(ITEMS, 'usd');
    assert.deepEqual(plan.yahoo, [
      { key: 'fx:USDSGD', url: yahooUrl('USDSGD=X') },
      { key: 'stocks:D05.SI', url: yahooUrl('D05.SI') },
      { key: 'stocks:^GSPC', url: yahooUrl('^GSPC') },
    ]);
    assert.deepEqual(plan.coinGecko, {
      ids: ['bitcoin', 'ethereum'],
      url: coinGeckoUrl(['bitcoin', 'ethereum'], 'usd'),
      keys: new Map([['crypto:btc:usd', 'bitcoin'], ['crypto:eth:usd', 'ethereum']]),
    });
  });

  test('no crypto means no CoinGecko request; duplicates are requested once', () => {
    const plan = planRequests([{ type: 'fx', symbol: 'USDSGD' }, { type: 'fx', symbol: 'USDSGD' }], 'usd');
    assert.equal(plan.yahoo.length, 1);
    assert.equal(plan.coinGecko, null);
  });

  test('two symbols for the same coin share one ID', () => {
    const plan = planRequests([{ type: 'crypto', symbol: 'btc' }, { type: 'crypto', symbol: 'bitcoin' }], 'usd');
    assert.deepEqual(plan.coinGecko.ids, ['bitcoin']);
    assert.equal(plan.coinGecko.keys.size, 2);
  });
});

describe('collectQuotes', () => {
  test('parses each response into a quote by item key', () => {
    const quotes = collectQuotes(planRequests(ITEMS, 'usd'), RESPONSES, NOW);
    assert.equal(quotes.get('fx:USDSGD').price, 1.277);
    assert.equal(quotes.get('stocks:D05.SI').marketOpen, true);
    assert.equal(quotes.get('stocks:^GSPC').marketOpen, false);
    assert.deepEqual(quotes.get('crypto:btc:usd'), { available: true, price: 80303, change24h: 4.48940120104541 });
  });

  test('a failed or missing response is unavailable, without affecting the others', () => {
    const responses = new Map(RESPONSES);
    responses.set(yahooUrl('D05.SI'), null);
    responses.delete(coinGeckoUrl(['bitcoin', 'ethereum'], 'usd'));
    const quotes = collectQuotes(planRequests(ITEMS, 'usd'), responses, NOW);
    assert.equal(quotes.get('stocks:D05.SI').available, false);
    assert.equal(quotes.get('crypto:btc:usd').available, false);
    assert.equal(quotes.get('fx:USDSGD').available, true);
  });

  test('a rate-limit page instead of JSON is unavailable', () => {
    const responses = new Map(RESPONSES);
    responses.set(yahooUrl('D05.SI'), 'Too Many Requests');
    assert.equal(collectQuotes(planRequests(ITEMS, 'usd'), responses, NOW).get('stocks:D05.SI').available, false);
  });
});

describe('buildRows: fresh data', () => {
  const quotes = collectQuotes(planRequests(ITEMS, 'usd'), RESPONSES, NOW);
  const { rows, cache, updatedAt } = buildRows(ITEMS, quotes, {}, NOW, 'usd');

  test('one row per item, in order, with label, price, arrow and tone', () => {
    assert.deepEqual(rows.map((r) => [r.label, r.price, r.arrow, r.tone]), [
      ['USD/SGD', '1.2770', '▼', 'down'],
      ['D05', '70.36', '▼', 'down'],
      ['S&P 500', '7,688.62', '▲', 'up'],
      ['BTC', '80,303', '▲', 'up'],
      ['ETH', '2,412', '▲', 'up'],
    ]);
  });

  test('fresh rows are not dimmed', () => {
    assert.ok(rows.every((r) => r.dimmed === false));
  });

  test('only a stock row whose market is closed is marked closed', () => {
    assert.deepEqual(rows.map((r) => r.closed), [false, false, true, false, false]);
  });

  test('saves each fresh quote in the cache with the time it was fetched', () => {
    assert.equal(cache['stocks:D05.SI'].price, 70.36);
    assert.equal(cache['stocks:D05.SI'].fetchedAt, NOW);
    assert.equal(cache['crypto:btc:usd'].price, 80303);
  });

  test('updatedAt is now when anything is fresh', () => {
    assert.equal(updatedAt, NOW);
  });

  test('a flat item has no arrow', () => {
    const cba = { type: 'stocks', symbol: 'CBA.AX' };
    const q = collectQuotes(planRequests([cba], 'usd'), new Map([[yahooUrl('CBA.AX'), text('yahoo-CBA.AX.json')]]), NOW);
    const [row] = buildRows([cba], q, {}, NOW, 'usd').rows;
    assert.equal(row.arrow, '');
    assert.equal(row.tone, 'flat');
  });
});

describe('buildRows: failures and the cache', () => {
  const fresh = buildRows(ITEMS, collectQuotes(planRequests(ITEMS, 'usd'), RESPONSES, NOW), {}, NOW, 'usd');
  const later = NOW + 15 * 60e3;
  const offline = collectQuotes(planRequests(ITEMS, 'usd'), new Map(), later);

  test('when a fetch fails, the saved value is shown dimmed', () => {
    const { rows } = buildRows(ITEMS, offline, fresh.cache, later, 'usd');
    assert.deepEqual(rows.map((r) => r.price), ['1.2770', '70.36', '7,688.62', '80,303', '2,412']);
    assert.ok(rows.every((r) => r.dimmed === true));
  });

  test('saved values keep their arrow and tone, but no closed marker', () => {
    const { rows } = buildRows(ITEMS, offline, fresh.cache, later, 'usd');
    assert.equal(rows[2].arrow, '▲');
    assert.ok(rows.every((r) => r.closed === false));
  });

  test('updatedAt is the newest saved time when nothing is fresh', () => {
    assert.equal(buildRows(ITEMS, offline, fresh.cache, later, 'usd').updatedAt, NOW);
  });

  test('with no saved value, the row shows — in grey, with no arrow', () => {
    const { rows, updatedAt } = buildRows(ITEMS, offline, {}, later, 'usd');
    for (const r of rows) {
      assert.equal(r.price, '—');
      assert.equal(r.arrow, '');
      assert.equal(r.tone, 'flat');
      assert.equal(r.dimmed, false);
    }
    assert.equal(updatedAt, null);
  });

  test('crypto saved in one currency is not shown for another', () => {
    const { rows } = buildRows([{ type: 'crypto', symbol: 'btc' }], offline, fresh.cache, later, 'sgd');
    assert.equal(rows[0].price, '—');
  });

  test('keeps other widgets\' entries, but drops entries older than the limit', () => {
    const cache = {
      'stocks:OTHER': { available: true, price: 1, fetchedAt: later - CACHE_MAX_AGE_DAYS * DAY },
      'stocks:OLD': { available: true, price: 1, fetchedAt: later - CACHE_MAX_AGE_DAYS * DAY - 1 },
    };
    const result = buildRows(ITEMS, offline, cache, later, 'usd').cache;
    assert.ok('stocks:OTHER' in result);
    assert.ok(!('stocks:OLD' in result));
  });

  test('a malformed cache or entry is ignored rather than crashing', () => {
    for (const bad of [null, 'oops', 42, [], { 'stocks:D05.SI': null }, { 'stocks:D05.SI': { price: 'x', fetchedAt: NOW } }]) {
      const { rows } = buildRows(ITEMS, offline, bad, later, 'usd');
      assert.equal(rows[1].price, '—', `cache: ${JSON.stringify(bad)}`);
    }
  });
});

describe('layoutFor', () => {
  const medium = parseParameter('fx:USDSGD,SGDJPY | stocks:D05.SI,^GSPC,CBA.AX | crypto:btc,eth,sol,xrp,ada');

  test('small: one column of up to 5 items across groups', () => {
    const { columns } = layoutFor('small', medium);
    assert.equal(columns.length, 1);
    assert.deepEqual(columns[0].map((i) => i.symbol), ['USDSGD', 'SGDJPY', 'D05.SI', '^GSPC', 'CBA.AX']);
  });

  test('medium: one column per group present, in order', () => {
    assert.deepEqual(layoutFor('medium', medium).columns.map((c) => c.length), [2, 3, 5]);
    assert.equal(layoutFor('medium', parseParameter('crypto:btc | fx:USDSGD')).columns.length, 2);
    assert.equal(layoutFor('medium', parseParameter('stocks:D05.SI')).columns.length, 1);
  });

  test('items carry their type', () => {
    assert.deepEqual(layoutFor('medium', parseParameter('crypto:btc')).columns[0], [{ type: 'crypto', symbol: 'btc' }]);
  });

  test('any other size uses the medium layout', () => {
    for (const family of ['large', 'extraLarge', undefined]) {
      assert.deepEqual(layoutFor(family, medium), layoutFor('medium', medium));
    }
  });
});

describe('refreshAfter', () => {
  test('is 15 minutes after now, as a Date', () => {
    const at = refreshAfter(NOW);
    assert.ok(at instanceof Date);
    assert.equal(at.getTime(), NOW + 15 * 60e3);
    assert.equal(refreshAfter(new Date(NOW)).getTime(), NOW + 15 * 60e3);
  });
});

describe('HELP_TEXT', () => {
  test('explains the groups, separators, cur:, the limit and the defaults', () => {
    for (const part of ['fx:', 'stocks:', 'crypto:', 'cur:', '|', '5', '.SI', '.AX', '^', 'USDSGD']) {
      assert.ok(HELP_TEXT.includes(part), `missing: ${part}`);
    }
    assert.ok(HELP_TEXT.includes('fx:USDSGD,SGDAUD,SGDJPY | stocks:^STI,^AXJO,^GSPC | crypto:btc,eth,sol | cur:usd'));
  });
});
