const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseYahooChart, parseCoinGecko, direction } = require('../src/core.js');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const meta = (name) => fixture(name).chart.result[0].meta;
// A copy of a fixture with its meta changed, for edge cases on a real shape.
function withMeta(name, change) {
  const json = fixture(name);
  change(json.chart.result[0].meta);
  return json;
}
const sec = (s) => s * 1000;
// Roughly when the Yahoo fixtures were copied: just after the last of them (SGDJPY, 10:14 SGT).
const CAPTURED = sec(1793844887);

describe('parseYahooChart with real fixtures', () => {
  test('D05.SI: SGX stock, open', () => {
    assert.deepEqual(parseYahooChart(fixture('yahoo-D05.SI.json'), CAPTURED), {
      available: true, price: 70.36, previousClose: 70.78, time: sec(1793842903), marketOpen: true, currency: 'SGD',
    });
  });

  test('CBA.AX: ASX stock, open, price equal to previous close', () => {
    assert.deepEqual(parseYahooChart(fixture('yahoo-CBA.AX.json'), CAPTURED), {
      available: true, price: 166.26, previousClose: 166.26, time: sec(1793843648), marketOpen: true, currency: 'AUD',
    });
  });

  test('^GSPC: index, closed (last trade time is after the close)', () => {
    assert.deepEqual(parseYahooChart(fixture('yahoo-GSPC.json'), CAPTURED), {
      available: true, price: 7688.62, previousClose: 7568.92, time: sec(1793829071), marketOpen: false, currency: 'USD',
    });
  });

  test('USDSGD=X and SGDJPY=X: FX, open, currency is the quote currency', () => {
    assert.deepEqual(parseYahooChart(fixture('yahoo-USDSGD.json'), CAPTURED), {
      available: true, price: 1.277, previousClose: 1.278, time: sec(1793843617), marketOpen: true, currency: 'SGD',
    });
    assert.deepEqual(parseYahooChart(fixture('yahoo-SGDJPY.json'), CAPTURED), {
      available: true, price: 123.682, previousClose: 123.835, time: sec(1793844887), marketOpen: true, currency: 'JPY',
    });
  });

  test('the error response for an unknown symbol is unavailable, with Yahoo\'s description', () => {
    const item = parseYahooChart(fixture('yahoo-invalid.json'), CAPTURED);
    assert.equal(item.available, false);
    assert.match(item.reason, /No data found/);
  });
});

describe('parseYahooChart: market open, at the boundaries', () => {
  const { start, end } = meta('yahoo-D05.SI.json').currentTradingPeriod.regular; // 09:00–17:00 SGT
  const open = (now) => parseYahooChart(fixture('yahoo-D05.SI.json'), now).marketOpen;

  test('open from the first second of the session', () => {
    assert.equal(open(sec(start) - 1), false);
    assert.equal(open(sec(start)), true);
  });

  test('closed from the session end', () => {
    assert.equal(open(sec(end) - 1), true);
    assert.equal(open(sec(end)), false);
  });

  test('accepts now as a Date', () => {
    assert.equal(parseYahooChart(fixture('yahoo-D05.SI.json'), new Date(sec(start))).marketOpen, true);
  });

  test('FX across Singapore and UTC midnight: the session starts 00:00 UTC, which is 08:00 SGT', () => {
    const fx = meta('yahoo-USDSGD.json').currentTradingPeriod.regular;
    assert.equal(new Date(sec(fx.start)).toISOString().slice(11, 16), '00:00');
    const fxOpen = (now) => parseYahooChart(fixture('yahoo-USDSGD.json'), now).marketOpen;
    assert.equal(fxOpen(sec(fx.start) - 1), false); // 07:59:59 SGT, 23:59:59 UTC the day before
    assert.equal(fxOpen(sec(fx.start)), true);
  });

  test('missing or malformed trading hours, or no now, give marketOpen null (unknown)', () => {
    const noPeriod = withMeta('yahoo-D05.SI.json', (m) => delete m.currentTradingPeriod);
    assert.equal(parseYahooChart(noPeriod, CAPTURED).marketOpen, null);
    const badPeriod = withMeta('yahoo-D05.SI.json', (m) => { m.currentTradingPeriod.regular.end = null; });
    assert.equal(parseYahooChart(badPeriod, CAPTURED).marketOpen, null);
    assert.equal(parseYahooChart(fixture('yahoo-D05.SI.json')).marketOpen, null);
    assert.equal(parseYahooChart(fixture('yahoo-D05.SI.json'), NaN).marketOpen, null);
  });
});

describe('parseYahooChart: missing and malformed data', () => {
  test('a missing, null or non-numeric price is unavailable', () => {
    for (const price of [undefined, null, '70.36', NaN, Infinity]) {
      const json = withMeta('yahoo-D05.SI.json', (m) => {
        if (price === undefined) delete m.regularMarketPrice;
        else m.regularMarketPrice = price;
      });
      assert.equal(parseYahooChart(json, CAPTURED).available, false, `price: ${price}`);
    }
  });

  test('a missing previousClose falls back to chartPreviousClose', () => {
    const json = withMeta('yahoo-D05.SI.json', (m) => { delete m.previousClose; m.chartPreviousClose = 70.5; });
    assert.equal(parseYahooChart(json, CAPTURED).previousClose, 70.5);
  });

  test('with neither previous close, the item is still available, with previousClose null', () => {
    const json = withMeta('yahoo-D05.SI.json', (m) => { m.previousClose = null; delete m.chartPreviousClose; });
    const item = parseYahooChart(json, CAPTURED);
    assert.equal(item.available, true);
    assert.equal(item.previousClose, null);
  });

  test('a missing time or currency becomes null', () => {
    const json = withMeta('yahoo-D05.SI.json', (m) => { delete m.regularMarketTime; delete m.currency; });
    const item = parseYahooChart(json, CAPTURED);
    assert.equal(item.time, null);
    assert.equal(item.currency, null);
  });

  test('shapes without a result are unavailable', () => {
    const cases = [
      null, undefined, {}, [], 42, { chart: null }, { chart: {} }, { chart: { result: [] } },
      { chart: { result: [null] } }, { chart: { result: [{}] } }, { chart: { result: null, error: null } },
    ];
    for (const json of cases) {
      assert.equal(parseYahooChart(json, CAPTURED).available, false, `input: ${JSON.stringify(json)}`);
    }
  });

  test('accepts JSON text, and malformed text is unavailable', () => {
    const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'yahoo-D05.SI.json'), 'utf8');
    assert.equal(parseYahooChart(text, CAPTURED).price, 70.36);
    for (const bad of ['', '{ not json', 'Too Many Requests', '<html>429</html>']) {
      const item = parseYahooChart(bad, CAPTURED);
      assert.equal(item.available, false, `input: ${bad}`);
      assert.equal(typeof item.reason, 'string');
    }
  });
});

describe('parseCoinGecko with real fixtures', () => {
  const ids = ['bitcoin', 'ethereum', 'solana'];

  test('USD prices and 24-hour changes', () => {
    assert.deepEqual(parseCoinGecko(fixture('coingecko-usd.json'), ids, 'usd'), new Map([
      ['bitcoin', { available: true, price: 80303, change24h: 4.48940120104541 }],
      ['ethereum', { available: true, price: 2411.69, change24h: 6.626462586007126 }],
      ['solana', { available: true, price: 95.29, change24h: 3.8917247354641042 }],
    ]));
  });

  test('SGD prices, and the currency is case-insensitive', () => {
    const parsed = parseCoinGecko(fixture('coingecko-sgd.json'), ids, 'SGD');
    assert.deepEqual(parsed.get('bitcoin'), { available: true, price: 102545, change24h: 4.324392751077145 });
  });

  test('an unknown ID (HTTP 200 with {}) is unavailable', () => {
    const parsed = parseCoinGecko(fixture('coingecko-invalid.json'), ['notarealcoin123'], 'usd');
    assert.equal(parsed.get('notarealcoin123').available, false);
  });

  test('an ID missing from an otherwise good response is unavailable; the others are kept', () => {
    const parsed = parseCoinGecko(fixture('coingecko-usd.json'), ['bitcoin', 'dogecoin'], 'usd');
    assert.equal(parsed.get('bitcoin').price, 80303);
    assert.equal(parsed.get('dogecoin').available, false);
    assert.equal(parsed.size, 2);
  });

  test('asking for a currency the response does not have makes every ID unavailable', () => {
    const parsed = parseCoinGecko(fixture('coingecko-usd.json'), ids, 'sgd');
    assert.ok([...parsed.values()].every((item) => item.available === false));
  });
});

describe('parseCoinGecko: missing and malformed data', () => {
  const json = () => fixture('coingecko-usd.json');

  test('a null or non-numeric price is unavailable', () => {
    for (const price of [null, '80303', NaN]) {
      const j = json();
      j.bitcoin.usd = price;
      assert.equal(parseCoinGecko(j, ['bitcoin'], 'usd').get('bitcoin').available, false, `price: ${price}`);
    }
  });

  test('a missing or null 24-hour change keeps the price, with change24h null', () => {
    const j = json();
    delete j.bitcoin.usd_24h_change;
    j.ethereum.usd_24h_change = null;
    const parsed = parseCoinGecko(j, ['bitcoin', 'ethereum'], 'usd');
    assert.deepEqual(parsed.get('bitcoin'), { available: true, price: 80303, change24h: null });
    assert.deepEqual(parsed.get('ethereum'), { available: true, price: 2411.69, change24h: null });
  });

  test('duplicate IDs give one entry, in first-seen order', () => {
    assert.deepEqual([...parseCoinGecko(json(), ['solana', 'bitcoin', 'solana'], 'usd').keys()], ['solana', 'bitcoin']);
  });

  test('no IDs gives an empty map', () => {
    assert.equal(parseCoinGecko(json(), [], 'usd').size, 0);
    assert.equal(parseCoinGecko(json(), undefined, 'usd').size, 0);
  });

  test('IDs that are object property names are not mistaken for data', () => {
    const parsed = parseCoinGecko(json(), ['constructor', '__proto__', 'toString'], 'usd');
    assert.ok([...parsed.values()].every((item) => item.available === false));
  });

  test('non-object responses, malformed text and a missing currency make every ID unavailable', () => {
    for (const bad of [null, undefined, [], 'not json', '', 42]) {
      const parsed = parseCoinGecko(bad, ['bitcoin'], 'usd');
      assert.equal(parsed.get('bitcoin').available, false, `input: ${JSON.stringify(bad)}`);
    }
    assert.equal(parseCoinGecko(json(), ['bitcoin'], undefined).get('bitcoin').available, false);
  });

  test('accepts JSON text', () => {
    const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'coingecko-usd.json'), 'utf8');
    assert.equal(parseCoinGecko(text, ['bitcoin'], 'usd').get('bitcoin').price, 80303);
  });
});

describe('direction', () => {
  const yahoo = (name) => parseYahooChart(fixture(name), CAPTURED);
  const coins = parseCoinGecko(fixture('coingecko-usd.json'), ['bitcoin'], 'usd');

  test('FX and stocks compare the price with the previous close (real fixtures)', () => {
    assert.equal(direction(yahoo('yahoo-D05.SI.json')), 'down'); // 70.36 vs 70.78
    assert.equal(direction(yahoo('yahoo-GSPC.json')), 'up'); // 7688.62 vs 7568.92
    assert.equal(direction(yahoo('yahoo-USDSGD.json')), 'down'); // 1.277 vs 1.278
    assert.equal(direction(yahoo('yahoo-CBA.AX.json')), 'flat'); // 166.26 vs 166.26
  });

  test('crypto uses the 24-hour change (real fixture)', () => {
    assert.equal(direction(coins.get('bitcoin')), 'up');
  });

  test('boundaries: just above, equal to and just below the previous close', () => {
    const item = (price) => ({ available: true, price, previousClose: 100, time: null, marketOpen: true, currency: 'SGD' });
    assert.equal(direction(item(100.01)), 'up');
    assert.equal(direction(item(100)), 'flat');
    assert.equal(direction(item(99.99)), 'down');
  });

  test('boundaries: 24-hour change just above, at and just below zero', () => {
    const coin = (change24h) => ({ available: true, price: 1, change24h });
    assert.equal(direction(coin(0.0001)), 'up');
    assert.equal(direction(coin(0)), 'flat');
    assert.equal(direction(coin(-0)), 'flat');
    assert.equal(direction(coin(-0.0001)), 'down');
  });

  test('crypto direction ignores any previous close', () => {
    assert.equal(direction({ available: true, price: 1, change24h: -2, previousClose: 0.5 }), 'down');
  });

  test('unavailable items, missing comparisons and odd input are flat', () => {
    assert.equal(direction(parseYahooChart(fixture('yahoo-invalid.json'), CAPTURED)), 'flat');
    assert.equal(direction({ available: true, price: 1, previousClose: null }), 'flat');
    assert.equal(direction({ available: true, price: 1, change24h: null }), 'flat');
    assert.equal(direction({ available: false, price: 2, previousClose: 1 }), 'flat');
    for (const odd of [null, undefined, {}, 42]) assert.equal(direction(odd), 'flat');
  });
});
