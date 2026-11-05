// Runs the built bundle (what goes on the phone) against stand-ins for Scriptable, with the real
// fixtures as the Yahoo and CoinGecko responses. No network calls.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildWidget } = require('../../../scripts/build.js');
const { yahooUrl, coinGeckoUrl } = require('../src/core.js');
const { runBundle, texts } = require('./support/scriptable.js');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const NOW = 1793844887 * 1000; // 10:14 SGT, just after the Yahoo fixtures were copied
const PARAM = 'fx:USDSGD,SGDJPY | stocks:D05.SI,CBA.AX,^GSPC | crypto:btc,eth,sol';

const BY_URL = new Map([
  [yahooUrl('USDSGD=X'), fixture('yahoo-USDSGD.json')],
  [yahooUrl('SGDJPY=X'), fixture('yahoo-SGDJPY.json')],
  [yahooUrl('D05.SI'), fixture('yahoo-D05.SI.json')],
  [yahooUrl('CBA.AX'), fixture('yahoo-CBA.AX.json')],
  [yahooUrl('^GSPC'), fixture('yahoo-GSPC.json')],
  [coinGeckoUrl(['bitcoin', 'ethereum', 'solana'], 'usd'), fixture('coingecko-usd.json')],
]);
// Known URLs get their fixture; any other Yahoo symbol gets Yahoo's real "not found" body.
const fixtures = async (url) => (BY_URL.has(url)
  ? { status: 200, body: BY_URL.get(url) }
  : { status: 404, body: fixture('yahoo-invalid.json') });
const offline = async () => { throw new Error('The Internet connection appears to be offline.'); };

const source = () => buildWidget('market-prices').source;
const run = (opts) => runBundle(source(), { now: NOW, responder: fixtures, parameter: PARAM, ...opts });
const words = (widget) => texts(widget).map((t) => t.text);
const priceText = (widget, value) => texts(widget).find((t) => t.text === value);

describe('medium widget with fixtures', () => {
  test('shows every item with its label and price', async () => {
    const { widget } = await run();
    const shown = words(widget);
    for (const t of ['USD/SGD', '1.2770', 'SGD/JPY', '123.68', 'D05', '70.36', 'CBA', '166.26', 'S&P 500', '7,688.62',
      'BTC', '80,303', 'ETH', '2,412', 'SOL', '95.29']) {
      assert.ok(shown.includes(t), `missing ${t}; shown: ${shown.join(' | ')}`);
    }
  });

  test('one column per group, top-aligned, with no headers', async () => {
    const { widget } = await run();
    const columns = widget.children.find((c) => c.kind === 'stack' && !c.vertical).children.filter((c) => c.kind === 'stack');
    assert.equal(columns.length, 3);
    assert.ok(columns.every((c) => c.vertical && c.align === 'top'));
    assert.ok(!words(widget).some((w) => /^(fx|stocks|crypto)$/i.test(w)));
  });

  test('arrows: ▲ and ▼ after the price, none for flat CBA', async () => {
    const shown = words((await run()).widget);
    assert.equal(shown.filter((w) => w === '▲').length, 4); // S&P 500, BTC, ETH, SOL
    assert.equal(shown.filter((w) => w === '▼').length, 3); // USD/SGD, SGD/JPY, D05
  });

  test('marks the closed market, and only that one', async () => {
    const shown = words((await run()).widget);
    assert.equal(shown.filter((w) => w === 'closed').length, 1);
  });

  test('shows when it was updated, refreshes in 15 minutes, and opens Yahoo Finance', async () => {
    const { widget } = await run();
    assert.ok(words(widget).includes('Updated 10:14am'));
    assert.equal(widget.refreshAfterDate.getTime(), NOW + 15 * 60e3);
    assert.equal(widget.url, 'https://finance.yahoo.com');
  });

  test('fetches each Yahoo symbol with a browser User-Agent, plus one CoinGecko request, without a key', async () => {
    const { requests } = await run();
    const yahoo = requests.filter((r) => r.url.includes('finance.yahoo.com'));
    const gecko = requests.filter((r) => r.url.includes('coingecko.com'));
    assert.equal(yahoo.length, 5);
    assert.equal(gecko.length, 1);
    assert.ok(yahoo.every((r) => /Mozilla/.test(r.headers['User-Agent'])));
    assert.ok(!('x-cg-demo-api-key' in gecko[0].headers));
  });

  test('sends the CoinGecko key from the Keychain, and only to CoinGecko', async () => {
    const { requests } = await run({ keychain: { 'market-prices.coingecko-key': 'demo-key' } });
    for (const r of requests) {
      const isGecko = r.url.includes('coingecko.com');
      assert.equal(r.headers['x-cg-demo-api-key'], isGecko ? 'demo-key' : undefined, r.url);
    }
  });

  test('colours: price and arrow share the tone colour; dynamic for light and dark', async () => {
    const { widget } = await run();
    const d05 = priceText(widget, '70.36');
    const gspc = priceText(widget, '7,688.62');
    assert.ok(d05.textColor.light && d05.textColor.dark, 'dynamic colour');
    assert.notDeepEqual(d05.textColor, gspc.textColor);
  });
});

describe('small widget', () => {
  test('one column of the first 5 items', async () => {
    const shown = words((await run({ family: 'small' })).widget);
    for (const t of ['USD/SGD', 'SGD/JPY', 'D05', 'CBA', 'S&P 500']) assert.ok(shown.includes(t), `missing ${t}`);
    for (const t of ['BTC', 'ETH', 'SOL']) assert.ok(!shown.includes(t), `unexpected ${t}`);
  });

  test('only fetches what it shows', async () => {
    const { requests } = await run({ family: 'small' });
    assert.equal(requests.length, 5);
    assert.ok(!requests.some((r) => r.url.includes('coingecko.com')));
  });
});

describe('failures and the cache', () => {
  test('offline with nothing saved: every price is —, without crashing', async () => {
    const { widget } = await run({ responder: offline });
    const shown = words(widget);
    assert.equal(shown.filter((w) => w === '—').length, 8);
    assert.ok(!shown.some((w) => w.startsWith('Updated ')));
  });

  test('offline after a good run: saved prices are shown dimmed, with the earlier update time', async () => {
    const files = {};
    await run({ files });
    const later = NOW + 30 * 60e3;
    const { widget } = await run({ files, responder: offline, now: later });
    const price = priceText(widget, '70.36');
    assert.ok(price, 'saved D05 price shown');
    assert.ok(price.textOpacity < 1, 'dimmed');
    assert.ok(words(widget).includes('Updated 10:14am'));
  });

  test('a rate-limited symbol shows its saved value while the others are fresh', async () => {
    const files = {};
    await run({ files });
    const limited = async (url) => (url === yahooUrl('D05.SI') ? { status: 429, body: 'Too Many Requests' } : fixtures(url));
    const { widget } = await run({ files, responder: limited });
    assert.ok(priceText(widget, '70.36').textOpacity < 1);
    assert.equal(priceText(widget, '7,688.62').textOpacity, 1);
  });

  test('an unknown symbol shows —', async () => {
    const shown = words((await run({ parameter: 'stocks:NOTAREALTICKER123.SI' })).widget);
    assert.ok(shown.includes('NOTAREALTICKER123'));
    assert.ok(shown.includes('—'));
  });
});

describe('parameter', () => {
  test('an empty parameter uses the default for the size', async () => {
    const { requests } = await run({ parameter: '' });
    assert.ok(requests.some((r) => r.url === yahooUrl('^STI')));
    assert.ok(requests.some((r) => r.url.includes('coingecko.com')));
  });

  test('cur: sets the crypto currency', async () => {
    const { requests } = await run({ parameter: 'crypto:btc | cur:sgd' });
    assert.equal(requests[0].url, coinGeckoUrl(['bitcoin'], 'sgd'));
  });
});

describe('in the app', () => {
  test('shows a menu with previews, the CoinGecko key and help, and closes on Done', async () => {
    const { alerts, widget } = await run({ runsInWidget: false });
    assert.equal(widget, null);
    const menu = alerts[0].actions.join(' | ');
    for (const a of ['Preview small', 'Preview medium', 'Set CoinGecko API key', 'Help']) assert.ok(menu.includes(a), menu);
  });

  test('Preview medium presents a medium widget, then the menu again', async () => {
    const { presented } = await run({ runsInWidget: false, alertChoices: [1, -1] });
    assert.equal(presented.length, 1);
    assert.equal(presented[0].presented, 'medium');
  });

  test('Set CoinGecko API key saves what was typed, trimmed, and the menu then offers to clear it', async () => {
    const keychain = {};
    // Menu: "Set CoinGecko API key" (2), then Save (0) in the prompt, then Done.
    const { alerts } = await run({ runsInWidget: false, alertChoices: [2, 0, -1], textInputs: ['  my-key  '], keychain });
    assert.equal(keychain['market-prices.coingecko-key'], 'my-key');
    assert.ok(alerts[2].actions.includes('Clear CoinGecko API key'));
  });

  test('an empty key or Cancel saves nothing', async () => {
    const keychain = {};
    await run({ runsInWidget: false, alertChoices: [2, 0, -1], textInputs: ['   '], keychain });
    await run({ runsInWidget: false, alertChoices: [2, -1, -1], textInputs: ['k'], keychain });
    assert.deepEqual(keychain, {});
  });

  test('Clear CoinGecko API key removes it', async () => {
    const keychain = { 'market-prices.coingecko-key': 'k' };
    await run({ runsInWidget: false, alertChoices: [3, -1], keychain });
    assert.deepEqual(keychain, {});
  });

  test('with a key set, the menu offers Change and Clear', async () => {
    const { alerts } = await run({ runsInWidget: false, keychain: { 'market-prices.coingecko-key': 'k' } });
    const menu = alerts[0].actions.join(' | ');
    assert.ok(menu.includes('Change CoinGecko API key'), menu);
    assert.ok(menu.includes('Clear CoinGecko API key'), menu);
  });

  test('Help shows the help text', async () => {
    const { alerts } = await run({ runsInWidget: false, alertChoices: [3, 0, -1] });
    assert.match(alerts[1].message, /fx:/);
  });
});

describe('the bundle', () => {
  test('never contains a CoinGecko key value', () => {
    assert.ok(!/x-cg-demo-api-key['"]\s*:\s*['"][^'"]+['"]/.test(source()));
  });
});
