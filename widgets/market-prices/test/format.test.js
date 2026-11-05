const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { label, formatPrice, COLUMN_MAX_CHARS } = require('../src/core.js');

describe('label', () => {
  test('FX pairs get a slash', () => {
    assert.equal(label({ type: 'fx', symbol: 'USDSGD' }), 'USD/SGD');
    assert.equal(label({ type: 'fx', symbol: 'SGDJPY' }), 'SGD/JPY');
  });

  test('stocks drop the exchange suffix', () => {
    assert.equal(label({ type: 'stocks', symbol: 'D05.SI' }), 'D05');
    assert.equal(label({ type: 'stocks', symbol: 'CBA.AX' }), 'CBA');
    assert.equal(label({ type: 'stocks', symbol: '7203.T' }), '7203');
  });

  test('stocks without a suffix, or with a dash, keep their ticker', () => {
    assert.equal(label({ type: 'stocks', symbol: 'AAPL' }), 'AAPL');
    assert.equal(label({ type: 'stocks', symbol: 'BRK-B' }), 'BRK-B');
  });

  test('indices from the plan get friendly names', () => {
    assert.equal(label({ type: 'stocks', symbol: '^GSPC' }), 'S&P 500');
    assert.equal(label({ type: 'stocks', symbol: '^STI' }), 'STI');
    assert.equal(label({ type: 'stocks', symbol: '^AXJO' }), 'ASX 200');
  });

  test('a few other common indices get friendly names too', () => {
    assert.equal(label({ type: 'stocks', symbol: '^DJI' }), 'Dow');
    assert.equal(label({ type: 'stocks', symbol: '^IXIC' }), 'Nasdaq');
    assert.equal(label({ type: 'stocks', symbol: '^N225' }), 'Nikkei');
  });

  test('any other index loses its ^', () => {
    assert.equal(label({ type: 'stocks', symbol: '^KS11' }), 'KS11');
    assert.equal(label({ type: 'stocks', symbol: '^HSI' }), 'HSI'); // "Hang Seng" would not fit a third
  });

  test('crypto is the uppercase symbol', () => {
    assert.equal(label({ type: 'crypto', symbol: 'btc' }), 'BTC');
    assert.equal(label({ type: 'crypto', symbol: 'eth' }), 'ETH');
  });

  test('odd input gives the symbol as it is, or an empty string', () => {
    assert.equal(label({ type: 'bonds', symbol: 'SG10Y' }), 'SG10Y');
    assert.equal(label({ type: 'fx', symbol: 'USD' }), 'USD');
    for (const odd of [null, undefined, {}, { type: 'fx' }]) assert.equal(label(odd), '');
  });
});

describe('formatPrice: FX', () => {
  test('4 decimal places', () => {
    assert.equal(formatPrice(1.277, 'fx', 'USDSGD', 'SGD'), '1.2770');
    assert.equal(formatPrice(0.8743219, 'fx', 'SGDAUD', 'AUD'), '0.8743');
  });

  test('2 decimal places for pairs quoted in JPY', () => {
    assert.equal(formatPrice(123.682, 'fx', 'SGDJPY', 'JPY'), '123.68');
    // The quote currency comes from the symbol even if the currency is missing.
    assert.equal(formatPrice(123.682, 'fx', 'SGDJPY', null), '123.68');
  });

  test('JPY as the base currency is still quoted in something else: 4 places', () => {
    assert.equal(formatPrice(0.0080852, 'fx', 'JPYSGD', 'SGD'), '0.0081');
  });

  test('rounds half up at the last place, both sides of the boundary', () => {
    assert.equal(formatPrice(1.27745, 'fx', 'USDSGD', 'SGD'), '1.2775');
    assert.equal(formatPrice(1.27744, 'fx', 'USDSGD', 'SGD'), '1.2774');
  });

  test('large rates get thousands separators', () => {
    assert.equal(formatPrice(16234.5, 'fx', 'USDIDR', 'IDR'), '16,234.5000');
  });
});

describe('formatPrice: stocks and indices', () => {
  test('2 decimal places with thousands separators', () => {
    assert.equal(formatPrice(70.36, 'stocks', 'D05.SI', 'SGD'), '70.36');
    assert.equal(formatPrice(166.26, 'stocks', 'CBA.AX', 'AUD'), '166.26');
    assert.equal(formatPrice(7688.62, 'stocks', '^GSPC', 'USD'), '7,688.62');
    assert.equal(formatPrice(5, 'stocks', 'X', 'USD'), '5.00');
  });

  test('0 decimal places for prices in JPY', () => {
    assert.equal(formatPrice(2845.5, 'stocks', '7203.T', 'JPY'), '2,846');
    assert.equal(formatPrice(38412.17, 'stocks', '^N225', 'JPY'), '38,412');
  });

  test('separators at the 999.99 / 1,000.00 boundary', () => {
    assert.equal(formatPrice(999.99, 'stocks', 'X', 'USD'), '999.99');
    assert.equal(formatPrice(999.995, 'stocks', 'X', 'USD'), '1,000.00');
    assert.equal(formatPrice(1000, 'stocks', 'X', 'USD'), '1,000.00');
  });
});

describe('formatPrice: crypto', () => {
  test('under 1: 2 significant digits', () => {
    assert.equal(formatPrice(0.5678, 'crypto', 'ada', 'usd'), '0.57');
    assert.equal(formatPrice(0.5, 'crypto', 'ada', 'usd'), '0.50');
    assert.equal(formatPrice(0.00001234, 'crypto', 'shib', 'usd'), '0.000012');
  });

  test('from 1 up to 99,999: whole numbers with separators', () => {
    assert.equal(formatPrice(1, 'crypto', 'x', 'usd'), '1');
    assert.equal(formatPrice(95.29, 'crypto', 'sol', 'usd'), '95');
    assert.equal(formatPrice(2411.69, 'crypto', 'eth', 'usd'), '2,412');
    assert.equal(formatPrice(80303, 'crypto', 'btc', 'usd'), '80,303');
    assert.equal(formatPrice(99999, 'crypto', 'btc', 'usd'), '99,999');
  });

  test('the 1 boundary: just under 1 keeps decimals; 1, or a value that rounds up to it, does not', () => {
    assert.equal(formatPrice(0.99, 'crypto', 'x', 'usd'), '0.99');
    assert.equal(formatPrice(0.995, 'crypto', 'x', 'usd'), '1');
    assert.equal(formatPrice(0.999, 'crypto', 'x', 'usd'), '1');
    assert.equal(formatPrice(1.4, 'crypto', 'x', 'usd'), '1');
  });

  test('above 99,999: K with one decimal, dropping .0', () => {
    assert.equal(formatPrice(102545, 'crypto', 'btc', 'sgd'), '102.5K');
    assert.equal(formatPrice(132500, 'crypto', 'btc', 'usd'), '132.5K');
    assert.equal(formatPrice(100000, 'crypto', 'btc', 'usd'), '100K');
  });

  test('the 99,999 / 100K boundary, including values that round up to it', () => {
    assert.equal(formatPrice(99999.4, 'crypto', 'btc', 'usd'), '99,999');
    assert.equal(formatPrice(99999.5, 'crypto', 'btc', 'usd'), '100K');
  });

  test('millions use M, including K values that would round to 1000.0K', () => {
    assert.equal(formatPrice(1234567, 'crypto', 'x', 'usd'), '1.2M');
    assert.equal(formatPrice(999949, 'crypto', 'x', 'usd'), '999.9K');
    assert.equal(formatPrice(999950, 'crypto', 'x', 'usd'), '1M');
  });

  test('billions use B', () => {
    assert.equal(formatPrice(2.5e9, 'crypto', 'x', 'usd'), '2.5B');
  });

  test('zero is 0', () => {
    assert.equal(formatPrice(0, 'crypto', 'x', 'usd'), '0');
  });
});

describe('formatPrice: no currency symbols, and odd input', () => {
  test('never adds a currency symbol or code', () => {
    const outputs = [
      formatPrice(1.277, 'fx', 'USDSGD', 'SGD'),
      formatPrice(7688.62, 'stocks', '^GSPC', 'USD'),
      formatPrice(2845.5, 'stocks', '7203.T', 'JPY'),
      formatPrice(102545, 'crypto', 'btc', 'sgd'),
    ];
    for (const out of outputs) assert.match(out, /^[0-9.,KMB-]+$/, out);
  });

  test('negative values keep their sign', () => {
    assert.equal(formatPrice(-37.63, 'stocks', 'CL=F', 'USD'), '-37.63');
  });

  test('a missing or non-numeric value is shown as —', () => {
    for (const v of [null, undefined, NaN, Infinity, '70.36']) {
      assert.equal(formatPrice(v, 'stocks', 'D05.SI', 'SGD'), '—', `value: ${v}`);
    }
  });

  test('an unknown type uses 2 decimal places', () => {
    assert.equal(formatPrice(1234.5, 'bonds', 'X', 'USD'), '1,234.50');
  });
});

describe('fits a one-third-width column', () => {
  // A row is: label, a space, the price, then the ▲/▼ arrow.
  const row = (type, symbol, value, currency) => `${label({ type, symbol })} ${formatPrice(value, type, symbol, currency)}▲`;
  const typical = [
    ['fx', 'USDSGD', 1.277, 'SGD'],
    ['fx', 'SGDAUD', 1.1874, 'AUD'],
    ['fx', 'SGDJPY', 123.682, 'JPY'],
    ['fx', 'EURSGD', 1.4852, 'SGD'],
    ['stocks', 'D05.SI', 70.36, 'SGD'],
    ['stocks', 'CBA.AX', 166.26, 'AUD'],
    ['stocks', '^GSPC', 7688.62, 'USD'],
    ['stocks', '^STI', 4512.33, 'SGD'],
    ['stocks', '^AXJO', 8812.3, 'AUD'],
    ['stocks', '^DJI', 47123.45, 'USD'],
    ['stocks', '^N225', 52345.67, 'JPY'],
    ['stocks', '^HSI', 26123.45, 'HKD'],
    ['crypto', 'btc', 80303, 'usd'],
    ['crypto', 'btc', 102545, 'sgd'],
    ['crypto', 'eth', 2411.69, 'usd'],
    ['crypto', 'sol', 95.29, 'usd'],
    ['crypto', 'doge', 0.1734, 'usd'],
  ];

  test(`typical rows are at most ${COLUMN_MAX_CHARS} characters`, () => {
    for (const item of typical) {
      const r = row(...item);
      assert.ok(r.length <= COLUMN_MAX_CHARS, `${r} is ${r.length} characters`);
    }
  });

  test('the limit is a sensible number', () => {
    assert.ok(Number.isInteger(COLUMN_MAX_CHARS) && COLUMN_MAX_CHARS >= 12 && COLUMN_MAX_CHARS <= 24);
  });
});
