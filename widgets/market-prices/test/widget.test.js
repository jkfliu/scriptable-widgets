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
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'widget.json'), 'utf8')).version;
const SETTINGS = '/documents/market-prices-settings.json';
const SCRIPT = '/documents/Market Prices.js';
const MANIFEST = 'https://raw.githubusercontent.com/jkfliu/scriptable-widgets/main/widgets/market-prices/version.json';
const SCRIPT_URL = 'https://raw.githubusercontent.com/jkfliu/scriptable-widgets/main/dist/Market%20Prices.js';
// By default an update check has just happened, so tests about prices see no update traffic.
const checkedJustNow = () => ({ [SETTINGS]: JSON.stringify({ updateChecks: true, lastChecked: NOW }) });
const run = (opts) => runBundle(source(), { now: NOW, responder: fixtures, parameter: PARAM, files: checkedJustNow(), ...opts });
const words = (widget) => texts(widget).map((t) => t.text);
const priceText = (widget, value) => texts(widget).find((t) => t.text === value);

describe('medium widget with fixtures', () => {
  test('shows every item with its label and price', async () => {
    const { widget } = await run();
    const shown = words(widget);
    for (const t of ['USD/SGD', '1.2770', 'SGD/JPY', '123.68', 'D05', '70.36', 'CBA', '166.26', 'S&P 500', '7,689',
      'BTC', '80,303', 'ETH', '2,412', 'SOL', '95.29']) {
      assert.ok(shown.includes(t), `missing ${t}; shown: ${shown.join(' | ')}`);
    }
  });

  test('one column per group, top-aligned, with no headers', async () => {
    const { widget } = await run();
    const body = widget.children.find((c) => c.kind === 'stack' && !c.vertical);
    const columns = body.children.filter((c) => c.kind === 'stack' && c.vertical);
    assert.equal(columns.length, 3);
    assert.ok(columns.every((c) => c.align === 'top'));
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

  test('a thin divider between each pair of columns, none at the edges', async () => {
    const { widget } = await run();
    const body = widget.children.find((c) => c.kind === 'stack' && !c.vertical);
    const dividers = body.children.filter((c) => c.kind === 'stack' && c.children.length === 0);
    assert.equal(dividers.length, 2);
    assert.ok(dividers.every((d) => d.size.width === 1 && d.size.height > 0 && d.backgroundColor));
    assert.notEqual(body.children[0], dividers[0]);
    assert.notEqual(body.children.at(-1), dividers[1]);
  });

  test('no divider with one column', async () => {
    const { widget } = await run({ parameter: 'stocks:D05.SI,^GSPC' });
    const body = widget.children.find((c) => c.kind === 'stack' && !c.vertical);
    assert.equal(body.children.filter((c) => c.kind === 'stack' && c.children.length === 0).length, 0);
  });

  test('fixed font sizes: no shrinking, and every label and price the same size', async () => {
    const { widget } = await run();
    const footer = texts(widget).at(-1);
    const rowTexts = texts(widget).filter((t) => t !== footer);
    assert.ok(rowTexts.every((t) => t.minimumScaleFactor === undefined || t.minimumScaleFactor === 1));
    const labels = ['USD/SGD', 'D05', 'S&P 500', 'BTC'].map((l) => texts(widget).find((t) => t.text === l));
    const prices = ['1.2770', '70.36', '7,689', '80,303'].map((p) => priceText(widget, p));
    assert.equal(new Set(labels.map((t) => t.font.size)).size, 1);
    assert.equal(new Set(prices.map((t) => t.font.size)).size, 1);
    assert.equal(labels[0].font.size, 10.5);
  });

  test('tight margins: 8 pt either side, and no extra spacing inside rows', async () => {
    const { widget } = await run();
    assert.deepEqual(widget.padding, [12, 8, 10, 8]);
    const body = widget.children.find((c) => c.kind === 'stack' && !c.vertical);
    const rows = body.children.filter((c) => c.vertical).flatMap((col) => col.children);
    for (const r of rows) {
      assert.equal(r.spacing, 0, 'row');
      for (const slot of r.children.filter((c) => c.kind === 'stack')) assert.equal(slot.spacing, 0, 'slot');
    }
  });

  test('labels and prices sit in fixed-width slots, prices aligned right', async () => {
    const { widget } = await run();
    const body = widget.children.find((c) => c.kind === 'stack' && !c.vertical);
    const rows = body.children.filter((c) => c.vertical).flatMap((col) => col.children);
    const slotWidths = new Set(rows.map((r) => r.children.filter((c) => c.kind === 'stack').map((s) => s.size.width).join('+')));
    assert.equal(slotWidths.size, 1, `slots: ${[...slotWidths]}`);
    for (const r of rows) {
      const priceSlot = r.children.filter((c) => c.kind === 'stack')[1];
      assert.equal(priceSlot.children[0].kind, 'spacer', 'price pushed right');
    }
  });

  test('colours: price and arrow share the tone colour; dynamic for light and dark', async () => {
    const { widget } = await run();
    const d05 = priceText(widget, '70.36');
    const gspc = priceText(widget, '7,689');
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
    assert.equal(priceText(widget, '7,689').textOpacity, 1);
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

describe('update checks', () => {
  const NEXT = '9.0.0';
  const manifest = JSON.stringify({ version: NEXT, notes: 'Bigger numbers' });
  const newScript = () => source().replace(`\nconst VERSION = '${VERSION}';\n`, `\nconst VERSION = '${NEXT}';\n`);
  const withUpdates = (extra = {}) => async (url) => {
    if (url === MANIFEST) return { status: 200, body: manifest };
    if (url === SCRIPT_URL) return extra.script ?? { status: 200, body: newScript() };
    return fixtures(url);
  };

  test('on by default: a first run checks version.json alongside the prices', async () => {
    const { requests, files } = await run({ files: {}, responder: withUpdates() });
    assert.ok(requests.some((r) => r.url === MANIFEST));
    const saved = JSON.parse(files[SETTINGS]);
    assert.equal(saved.lastChecked, NOW);
    assert.deepEqual(saved.latest, { version: NEXT, notes: 'Bigger numbers' });
  });

  test('a newer release shows "↑ update" in the widget', async () => {
    const { widget } = await run({ files: {}, responder: withUpdates() });
    assert.ok(words(widget).includes('↑ update'));
  });

  test('no badge when the latest release is the installed version', async () => {
    const same = async (url) => (url === MANIFEST ? { status: 200, body: JSON.stringify({ version: VERSION }) } : fixtures(url));
    assert.ok(!words((await run({ files: {}, responder: same })).widget).includes('↑ update'));
  });

  test('checks at most once a day', async () => {
    const { requests } = await run({ responder: withUpdates() });
    assert.ok(!requests.some((r) => r.url === MANIFEST));
  });

  test('turned off: no check and no badge, even with a newer release saved', async () => {
    const files = { [SETTINGS]: JSON.stringify({ updateChecks: false, latest: { version: NEXT, notes: '' } }) };
    const { requests, widget } = await run({ files, responder: withUpdates() });
    assert.ok(!requests.some((r) => r.url === MANIFEST));
    assert.ok(!words(widget).includes('↑ update'));
  });

  test('a failed check still records the time, so it is not retried on every refresh', async () => {
    const failing = async (url) => { if (url === MANIFEST) throw new Error('offline'); return fixtures(url); };
    const { files, widget } = await run({ files: {}, responder: failing });
    assert.equal(JSON.parse(files[SETTINGS]).lastChecked, NOW);
    assert.ok(words(widget).includes('70.36'), 'prices still shown');
  });

  test('in the app: the menu shows the version and offers the update first', async () => {
    const files = { ...checkedJustNow(), [SETTINGS]: JSON.stringify({ lastChecked: NOW, latest: { version: NEXT, notes: '' } }) };
    const { alerts } = await run({ runsInWidget: false, files });
    assert.match(alerts[0].message, new RegExp(`Version ${VERSION.replace(/\./g, '\\.')}`));
    assert.equal(alerts[0].actions[0], `Install update ${NEXT}`);
    assert.ok(alerts[0].actions.includes('Turn off update checks'));
  });

  test('Install update: shows the notes, keeps a backup, and replaces the script', async () => {
    const files = { [SETTINGS]: JSON.stringify({ lastChecked: NOW, latest: { version: NEXT, notes: 'Bigger numbers' } }), [SCRIPT]: 'old script' };
    // Menu: Install update (0), confirm (0), "installed" message (0), then Done.
    const { alerts } = await run({ runsInWidget: false, files, responder: withUpdates(), alertChoices: [0, 0, 0, -1] });
    assert.match(alerts[1].message, /Bigger numbers/);
    assert.equal(files['/documents/Market Prices (previous).js'], 'old script');
    assert.ok(files[SCRIPT].includes(`\nconst VERSION = '${NEXT}';\n`));
    assert.match(alerts[2].title, /installed/);
  });

  test('a download that is not the expected script is refused, leaving the current one', async () => {
    const files = { [SETTINGS]: JSON.stringify({ lastChecked: NOW, latest: { version: NEXT, notes: '' } }), [SCRIPT]: 'old script' };
    const bad = withUpdates({ script: { status: 200, body: '<html>Not found</html>' } });
    const { alerts } = await run({ runsInWidget: false, files, responder: bad, alertChoices: [0, 0, 0, -1] });
    assert.equal(files[SCRIPT], 'old script');
    assert.match(alerts[2].title, /not installed/);
  });

  test('a failed download (HTTP 404) is refused too', async () => {
    const files = { [SETTINGS]: JSON.stringify({ lastChecked: NOW, latest: { version: NEXT, notes: '' } }), [SCRIPT]: 'old script' };
    const missing = withUpdates({ script: { status: 404, body: '404: Not Found' } });
    await run({ runsInWidget: false, files, responder: missing, alertChoices: [0, 0, 0, -1] });
    assert.equal(files[SCRIPT], 'old script');
  });

  test('Turn off update checks saves the choice; turning them on asks first, then checks', async () => {
    const files = checkedJustNow();
    // No key, no update: Preview small, Preview medium, Set key, Help, Turn off update checks (4).
    await run({ runsInWidget: false, files, alertChoices: [4, -1] });
    assert.equal(JSON.parse(files[SETTINGS]).updateChecks, false);
    const { requests } = await run({ runsInWidget: false, files, responder: withUpdates(), alertChoices: [4, 0, -1] });
    assert.equal(JSON.parse(files[SETTINGS]).updateChecks, true);
    assert.ok(requests.some((r) => r.url === MANIFEST));
  });

  test('turning update checks on can be cancelled: they stay off and nothing is fetched', async () => {
    const files = { [SETTINGS]: JSON.stringify({ updateChecks: false, lastChecked: NOW }) };
    const { requests } = await run({ runsInWidget: false, files, responder: withUpdates(), alertChoices: [4, -1, -1] });
    assert.equal(JSON.parse(files[SETTINGS]).updateChecks, false);
    assert.ok(!requests.some((r) => r.url === MANIFEST));
  });
});

describe('the bundle', () => {
  test('only talks to Yahoo Finance, CoinGecko and this repo on GitHub', () => {
    const hosts = new Set([...source().matchAll(/https?:\/\/([^/'"`\s]+)/g)].map((m) => m[1]));
    assert.deepEqual([...hosts].sort(), ['api.coingecko.com', 'finance.yahoo.com', 'query1.finance.yahoo.com', 'raw.githubusercontent.com']);
  });

  test('never runs downloaded code: no eval, Function constructor or importModule', () => {
    assert.ok(!/\beval\s*\(|new Function\s*\(|\bimportModule\s*\(/.test(source()));
  });

  test('never contains a CoinGecko key value', () => {
    assert.ok(!/x-cg-demo-api-key['"]\s*:\s*['"][^'"]+['"]/.test(source()));
  });
});
