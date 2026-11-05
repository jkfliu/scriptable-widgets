// Scriptable layer: requests, Keychain, file cache and drawing. Kept thin: logic lives in core.js.
// Only runs inside Scriptable; test/widget.test.js runs the built bundle against stand-ins.
// The build strips the requires below.
const {
  resolveParameter, layoutFor, planRequests, collectQuotes, buildRows, coinGeckoHeaders, refreshAfter, HELP_TEXT,
  columnMetrics, readSettings, updateDue, updateAvailable,
} = require('./core.js');
const { formatUpdated } = require('../../../shared/time.js');
const { parseManifest, updateUrl, isPlausibleUpdate } = require('../../../shared/update.js');
const {
  readJsonFile, writeJsonFile, keychainHas, keychainGet, keychainSet, keychainRemove,
} = require('../../../shared/storage.js');

// All set by scripts/build.js from widget.json; the update source is fixed in the published script.
const VERSION = 'dev';
const UPDATE_REPO = '';
const UPDATE_WIDGET = '';
const UPDATE_SCRIPT = '';

const KEYCHAIN_KEY = 'market-prices.coingecko-key';
const CACHE_FILE = 'market-prices-cache.json';
const SETTINGS_FILE = 'market-prices-settings.json';
const BACKUP_NAME = 'Market Prices (previous).js';
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
const UPDATE_COLOUR = new Color('#2e86de');
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

function buildWidget(family, columns, rows, updatedAt, now, update) {
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
  const footer = w.addStack();
  footer.layoutHorizontally();
  addText(footer, updatedAt === null ? 'No prices yet' : formatUpdated(updatedAt), Font.systemFont(9), MUTED);
  if (update) {
    footer.addSpacer();
    addText(footer, '↑ update', Font.mediumSystemFont(9), UPDATE_COLOUR);
  }
  return w;
}

// Builds the widget. When checkUpdates is set and a check is due, version.json is fetched
// alongside the prices, so the check never delays the refresh.
async function render(family, now, settings, checkUpdates = false) {
  const parsed = resolveParameter(args.widgetParameter, family);
  const { columns } = layoutFor(family, parsed);
  const [, { rows, updatedAt }] = await Promise.all([
    checkUpdates && UPDATE_URLS && updateDue(settings, now) ? checkForUpdate(settings, now) : null,
    loadRows(columns.flat(), parsed.currency, now),
  ]);
  return buildWidget(family, columns, rows, updatedAt, now, showUpdate(settings));
}

// --- Updates (on by default; turned off in the in-app menu) ---

// null in a dev build (no repo set), which turns all update features off.
const UPDATE_URLS = updateUrl(UPDATE_REPO, UPDATE_WIDGET, UPDATE_SCRIPT);

const loadSettings = () => readSettings(readJsonFile(SETTINGS_FILE));
const saveSettings = (settings) => writeJsonFile(SETTINGS_FILE, settings);
const showUpdate = (settings) => Boolean(UPDATE_URLS) && updateAvailable(settings, VERSION);

// The response body as text; throws on a non-200 status.
async function loadText(url, timeout) {
  const req = new Request(url);
  req.timeoutInterval = timeout;
  const text = await req.loadString();
  if (req.response.statusCode !== 200) throw new Error(`HTTP ${req.response.statusCode}`);
  return text;
}

// Fetches version.json and records it. Only reads the manifest: nothing is installed here.
async function checkForUpdate(settings, now) {
  settings.lastChecked = now; // even on failure, so a broken network doesn't mean a check every refresh
  try {
    const manifest = parseManifest(await loadText(UPDATE_URLS.manifest, 10));
    if (manifest) settings.latest = manifest;
  } catch (e) {
    console.error(`Market Prices update check: ${e}`);
  }
  saveSettings(settings);
}

// The FileManager that owns a path: iCloud if it's in Scriptable's iCloud folder, else local.
function fileManagerFor(path) {
  try {
    const icloud = FileManager.iCloud();
    if (path.startsWith(icloud.documentsDirectory())) return icloud;
  } catch (e) {
    // iCloud is off for Scriptable, so the script must be stored locally.
  }
  return FileManager.local();
}

// Downloads the new script, checks it, backs up the current one, then overwrites it.
// Throws with a readable message on any failure, leaving the current script untouched.
async function installUpdate(latest) {
  let source;
  try {
    source = await loadText(UPDATE_URLS.script, 30);
  } catch (e) {
    throw new Error(`Download failed (${e.message ?? e}).`);
  }
  const check = isPlausibleUpdate(source, latest.version, VERSION);
  if (!check.ok) throw new Error(check.reason);
  const self = module.filename;
  const fm = fileManagerFor(self);
  fm.writeString(self.replace(/[^/]+$/, BACKUP_NAME), fm.readString(self));
  fm.writeString(self, source);
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

async function showMessage(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction('OK');
  await a.present();
}

// true if the user taps `ok`.
async function confirm(title, message, ok, cancel = 'Cancel') {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction(ok);
  a.addCancelAction(cancel);
  return (await a.present()) === 0;
}

async function offerUpdate(settings) {
  const { version, notes } = settings.latest;
  const message = `${notes || 'No release notes.'}\n\nInstalled: ${VERSION}. The current script is kept as "${BACKUP_NAME}".`;
  if (!(await confirm(`Update to ${version}?`, message, 'Install update', 'Not now'))) return;
  try {
    await installUpdate(settings.latest);
    await showMessage('Update installed', `Market Prices ${version} is installed. Run the script again to use it.`);
  } catch (e) {
    await showMessage('Update not installed', `${e.message ?? e}\n\nYour current script hasn't changed.`);
  }
}

async function toggleUpdateChecks(settings, now) {
  if (settings.updateChecks) {
    settings.updateChecks = false;
    saveSettings(settings);
    return;
  }
  const message = `Once a day, Market Prices will look for a new version at github.com/${UPDATE_REPO}. `
    + 'Nothing installs by itself. If you tap Install, the new script downloaded from that repo '
    + 'replaces this one and runs on your phone.';
  if (!(await confirm('Turn on update checks?', message, 'Turn on'))) return;
  settings.updateChecks = true;
  await checkForUpdate(settings, now);
}

async function runInApp(now) {
  const settings = loadSettings();
  for (;;) {
    const hasKey = keychainHas(KEYCHAIN_KEY);
    const update = showUpdate(settings);
    const menu = new Alert();
    menu.title = 'Market Prices';
    menu.message = [
      `Version ${VERSION}${update ? ` (${settings.latest.version} available)` : ''}`,
      `CoinGecko API key: ${hasKey ? 'set' : 'not set'}`,
      ...(UPDATE_URLS ? [`Update checks: ${settings.updateChecks ? 'on' : 'off'}`] : []),
    ].join('\n');
    // [title, action, destructive]
    const actions = [
      ...(update ? [[`Install update ${settings.latest.version}`, () => offerUpdate(settings)]] : []),
      ['Preview small', async () => (await render('small', now, settings)).presentSmall()],
      ['Preview medium', async () => (await render('medium', now, settings)).presentMedium()],
      [hasKey ? 'Change CoinGecko API key' : 'Set CoinGecko API key', promptForKey],
      ...(hasKey ? [['Clear CoinGecko API key', () => keychainRemove(KEYCHAIN_KEY), true]] : []),
      ['Help', showHelp],
      ...(UPDATE_URLS ? [[settings.updateChecks ? 'Turn off update checks' : 'Turn on update checks',
        () => toggleUpdateChecks(settings, now)]] : []),
    ];
    for (const [title, , destructive] of actions) {
      if (destructive) menu.addDestructiveAction(title);
      else menu.addAction(title);
    }
    menu.addCancelAction('Done');
    const choice = await menu.presentSheet();
    if (choice === -1) return;
    await actions[choice][1]();
  }
}

// --- Entry point ---

const now = Date.now();
if (config.runsInWidget) {
  Script.setWidget(await render(config.widgetFamily, now, loadSettings(), true));
} else {
  await runInApp(now);
}
Script.complete();
