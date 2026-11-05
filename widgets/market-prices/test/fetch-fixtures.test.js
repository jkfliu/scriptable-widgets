const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { fixtureName } = require('../scripts/fetch-fixtures.js');

describe('fixtureName', () => {
  test('Yahoo stocks keep their exchange suffix', () => {
    assert.equal(fixtureName('yahoo', 'D05.SI'), 'yahoo-D05.SI.json');
    assert.equal(fixtureName('yahoo', 'CBA.AX'), 'yahoo-CBA.AX.json');
  });

  test('Yahoo indices drop the ^ and FX pairs drop =X', () => {
    assert.equal(fixtureName('yahoo', '^GSPC'), 'yahoo-GSPC.json');
    assert.equal(fixtureName('yahoo', 'USDSGD=X'), 'yahoo-USDSGD.json');
  });

  test('an optional label marks the market state, e.g. closed', () => {
    assert.equal(fixtureName('yahoo', '^GSPC', 'closed'), 'yahoo-GSPC.closed.json');
    assert.equal(fixtureName('coingecko', 'usd', ''), 'coingecko-usd.json');
  });

  test('anything outside letters, digits, dots and dashes is removed, and leading dots too, so names stay safe', () => {
    assert.equal(fixtureName('yahoo', '../evil/x'), 'yahoo-evilx.json');
    assert.equal(fixtureName('yahoo', 'a b'), 'yahoo-ab.json');
  });

  test('throws on an empty name, so nothing is saved as "yahoo-.json"', () => {
    assert.throws(() => fixtureName('yahoo', ''), /symbol/);
    assert.throws(() => fixtureName('yahoo', '^'), /symbol/);
    assert.throws(() => fixtureName('', 'X'), /source/);
  });
});
