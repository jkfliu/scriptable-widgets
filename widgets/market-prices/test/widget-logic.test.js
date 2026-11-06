const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  yahooUrl, coinGeckoUrl, coinGeckoHeaders, itemKey, planRequests, collectQuotes, buildRows,
  layoutFor, refreshAfter, parseParameter, HELP_TEXT, CACHE_MAX_AGE_DAYS, columnMetrics,
  readSettings, updateDue, updateAvailable,
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
      ['S&P 500', '7,689', '▲', 'up'],
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
    assert.deepEqual(rows.map((r) => r.price), ['1.2770', '70.36', '7,689', '80,303', '2,412']);
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

describe('columnMetrics', () => {
  test('one font size per layout: 10.5 pt with three columns, 11 pt otherwise', () => {
    assert.equal(columnMetrics('medium', 3).fontSize, 10.5);
    assert.equal(columnMetrics('medium', 2).fontSize, 11);
    assert.equal(columnMetrics('medium', 1).fontSize, 11);
    assert.equal(columnMetrics('small', 1).fontSize, 11);
  });

  test('columns, gaps and dividers fit the content width exactly', () => {
    for (const [family, n] of [['medium', 1], ['medium', 2], ['medium', 3], ['small', 1]]) {
      const m = columnMetrics(family, n);
      const used = n * m.columnWidth + (n - 1) * (2 * m.dividerGap + m.dividerWidth);
      assert.ok(Math.abs(used - m.contentWidth) < 1e-9, `${family} ${n}: ${used} vs ${m.contentWidth}`);
    }
  });

  test('each column splits into a fixed label slot and a fixed price slot', () => {
    for (const n of [1, 2, 3]) {
      const m = columnMetrics('medium', n);
      assert.ok(m.labelWidth > 0 && m.priceWidth > 0);
      assert.equal(m.labelWidth + m.priceWidth, m.columnWidth);
    }
  });

  test('every column in a layout is the same width', () => {
    const m = columnMetrics('medium', 3);
    assert.ok(m.columnWidth > 100 && m.columnWidth < 110, `three columns of ${m.columnWidth} pt`);
  });

  test('tight margins: 8 pt each side, 2 pt either side of a divider; content is the widget width less padding', () => {
    const medium = columnMetrics('medium', 3);
    assert.deepEqual(medium.padding, { top: 12, side: 8, bottom: 10 });
    assert.equal(medium.dividerGap, 2);
    assert.equal(medium.contentWidth, 338 - 2 * 8);
    assert.equal(columnMetrics('small', 1).contentWidth, 158 - 2 * 8);
  });

  test('typical labels and prices fit their slots at the chosen size (estimated character widths)', () => {
    // Rough widths of San Francisco text, as a fraction of the font size.
    const em = { digit: 0.6, narrow: 0.3, upper: 0.68, other: 0.62 };
    const width = (s, size) => [...s].reduce((sum, ch) => sum + size * (
      /[0-9]/.test(ch) ? em.digit : /[.,\s]/.test(ch) ? em.narrow : /[A-Z&]/.test(ch) ? em.upper : em.other), 0);
    const m = columnMetrics('medium', 3);
    for (const l of ['S&P 500', 'ASX 200', 'USD/SGD', 'SGD/AUD', 'SGD/JPY', 'Nasdaq']) {
      assert.ok(width(l, m.fontSize) <= m.labelWidth, `${l}: ${width(l, m.fontSize)} > ${m.labelWidth}`);
    }
    // On the phone, prices came out about 25% wider than these estimates: at 10 pt they fit a
    // 51.7 pt slot, at 10.5 pt they did not fit 48.7 pt (1.1.1). Labels matched the estimates.
    const PRICE_CALIBRATION = 1.25;
    for (const p of ['7,689', '8,812', '47,123', '23,457', '123.68', '166.26', '1.2770', '102.5K', '80,303']) {
      const w = (width(p, m.fontSize) + m.arrowWidth) * PRICE_CALIBRATION;
      assert.ok(w <= m.priceWidth, `${p}: ${w} > ${m.priceWidth}`);
    }
  });

  test('a column count below 1 is treated as 1', () => {
    assert.deepEqual(columnMetrics('medium', 0), columnMetrics('medium', 1));
  });
});

describe('update settings', () => {
  test('update checks are on by default, with nothing checked yet', () => {
    for (const raw of [{}, null, undefined, 'oops', [], 42]) {
      assert.deepEqual(readSettings(raw), { updateChecks: true, lastChecked: null, latest: null }, `raw: ${JSON.stringify(raw)}`);
    }
  });

  test('keeps a saved choice, last check time and latest manifest', () => {
    assert.deepEqual(
      readSettings({ updateChecks: false, lastChecked: NOW, latest: { version: '1.2.0', notes: 'New' } }),
      { updateChecks: false, lastChecked: NOW, latest: { version: '1.2.0', notes: 'New' } },
    );
  });

  test('only an explicit false turns checks off; malformed values are dropped', () => {
    assert.equal(readSettings({ updateChecks: 'no' }).updateChecks, true);
    assert.equal(readSettings({ lastChecked: 'yesterday' }).lastChecked, null);
    assert.equal(readSettings({ latest: { version: '1.2' } }).latest, null);
    assert.deepEqual(readSettings({ latest: { version: '1.2.0' } }).latest, { version: '1.2.0', notes: '' });
  });
});

describe('updateDue', () => {
  test('due when never checked, or a full day after the last check', () => {
    assert.equal(updateDue(readSettings({}), NOW), true);
    assert.equal(updateDue(readSettings({ lastChecked: NOW - DAY }), NOW), true);
    assert.equal(updateDue(readSettings({ lastChecked: NOW - DAY + 1 }), NOW), false);
  });

  test('never due when update checks are off', () => {
    assert.equal(updateDue(readSettings({ updateChecks: false }), NOW), false);
  });
});

describe('updateAvailable', () => {
  const latest = (version) => readSettings({ latest: { version, notes: '' } });

  test('only when the latest release is newer than the installed version', () => {
    assert.equal(updateAvailable(latest('1.1.0'), '1.0.1'), true);
    assert.equal(updateAvailable(latest('1.10.0'), '1.9.0'), true);
    assert.equal(updateAvailable(latest('1.0.1'), '1.0.1'), false);
    assert.equal(updateAvailable(latest('1.0.0'), '1.0.1'), false);
  });

  test('not when nothing is known, the version is "dev", or checks are off', () => {
    assert.equal(updateAvailable(readSettings({}), '1.0.1'), false);
    assert.equal(updateAvailable(latest('1.1.0'), 'dev'), false);
    assert.equal(updateAvailable(readSettings({ updateChecks: false, latest: { version: '9.0.0' } }), '1.0.1'), false);
  });
});
