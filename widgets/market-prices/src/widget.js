// Scriptable layer: requests, Keychain, file cache and drawing. Kept thin: logic lives in core.js.
// Only runs inside Scriptable; test/widget.test.js runs the built bundle against stand-ins.
// The build strips the requires below.
const {
  resolveParameter, layoutFor, planRequests, collectQuotes, buildRows, coinGeckoHeaders, refreshAfter, HELP_TEXT,
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
const DIMMED = 0.5;

// Content widths in points for a 6.1" iPhone (padding taken off). Text shrinks to fit if needed.
const CONTENT_WIDTH = { small: 134, medium: 314 };
const COLUMN_GAP = 10;
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

function addText(stack, text, font, colour, opacity = 1) {
  const t = stack.addText(text);
  t.font = font;
  t.textColor = colour;
  t.textOpacity = opacity;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.7;
  return t;
}

// Label (with a small "closed" under it when that market is closed) on the left; price and arrow on the right.
function addRow(column, row, width) {
  const line = column.addStack();
  line.layoutHorizontally();
  line.centerAlignContent();
  line.size = new Size(width, ROW_HEIGHT);
  const opacity = row.dimmed ? DIMMED : 1;

  const left = line.addStack();
  left.layoutVertically();
  addText(left, row.label, Font.semiboldSystemFont(11), FG, opacity);
  if (row.closed) addText(left, 'closed', Font.systemFont(7), MUTED);

  line.addSpacer();
  const colour = TONES[row.tone] ?? MUTED;
  addText(line, row.price, Font.mediumSystemFont(11), colour, opacity);
  if (row.arrow) {
    line.addSpacer(1);
    addText(line, row.arrow, Font.systemFont(8), colour, opacity);
  }
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
  const total = family === 'small' ? CONTENT_WIDTH.small : CONTENT_WIDTH.medium;
  const width = (total - COLUMN_GAP * (columns.length - 1)) / columns.length;
  let next = 0;
  columns.forEach((items, i) => {
    if (i > 0) body.addSpacer(COLUMN_GAP);
    const column = body.addStack();
    column.layoutVertically();
    column.topAlignContent();
    for (let n = 0; n < items.length; n++) addRow(column, rows[next++], width);
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
