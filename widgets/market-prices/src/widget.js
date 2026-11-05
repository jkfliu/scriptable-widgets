// Scriptable layer: requests, Keychain, file cache and drawing. Kept thin: logic lives in core.js.
// Only runs inside Scriptable; test/widget.test.js runs the built bundle against stand-ins.
// The build strips the requires below.
const {
  resolveParameter, layoutFor, planRequests, collectQuotes, buildRows, coinGeckoHeaders, refreshAfter, HELP_TEXT,
  columnMetrics,
} = require('./core.js');
const { formatUpdated } = require('../../../shared/time.js');
const {
  readJsonFile, writeJsonFile, keychainHas, keychainGet, keychainSet, keychainRemove,
} = require('../../../shared/storage.js');

// Set by scripts/build.js from widget.json.
const VERSION = 'dev';

const KEYCHAIN_KEY = 'market-prices.coingecko-key';
const CACHE_FILE = 'market-prices-cache.json';
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

function buildWidget(family, columns, rows, updatedAt, now) {
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
  addText(w, updatedAt === null ? 'No prices yet' : formatUpdated(updatedAt), Font.systemFont(9), MUTED);
  return w;
}

async function render(family, now) {
  const parsed = resolveParameter(args.widgetParameter, family);
  const { columns } = layoutFor(family, parsed);
  const { rows, updatedAt } = await loadRows(columns.flat(), parsed.currency, now);
  return buildWidget(family, columns, rows, updatedAt, now);
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

async function runInApp(now) {
  for (;;) {
    const hasKey = keychainHas(KEYCHAIN_KEY);
    const menu = new Alert();
    menu.title = 'Market Prices';
    menu.message = `Version ${VERSION}\nCoinGecko API key: ${hasKey ? 'set' : 'not set'}`;
    const actions = [
      ['Preview small', async () => (await render('small', now)).presentSmall()],
      ['Preview medium', async () => (await render('medium', now)).presentMedium()],
      [hasKey ? 'Change CoinGecko API key' : 'Set CoinGecko API key', promptForKey],
    ];
    for (const [title] of actions) menu.addAction(title);
    if (hasKey) {
      menu.addDestructiveAction('Clear CoinGecko API key');
      actions.push(['Clear CoinGecko API key', () => keychainRemove(KEYCHAIN_KEY)]);
    }
    menu.addAction('Help');
    actions.push(['Help', showHelp]);
    menu.addCancelAction('Done');
    const choice = await menu.presentSheet();
    if (choice === -1) return;
    await actions[choice][1]();
  }
}

// --- Entry point ---

const now = Date.now();
if (config.runsInWidget) {
  Script.setWidget(await render(config.widgetFamily, now));
} else {
  await runInApp(now);
}
Script.complete();
