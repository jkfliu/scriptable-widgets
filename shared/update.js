// Update checker shared by widgets: versions, the version.json manifest, and where to fetch updates.
// Each widget has its own manifest at widgets/<folder>/version.json and its script at dist/<output>
// on the release branch of this repo.

const { DAY, toMs } = require('./time.js');

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const REPO_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const WIDGET_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SCRIPT_PATTERN = /^[^/\\]+\.js$/;
const UPDATE_CHECK_EVERY = DAY;
const SCRIPTABLE_HEADER = '// Variables used by Scriptable.';
const RELEASE_BRANCH = 'main';

const parseVersion = (v) => (typeof v === 'string' && v.match(VERSION_PATTERN)?.slice(1).map(Number)) || null;
const isVersion = (v) => parseVersion(v) !== null;

// The line scripts/build.js writes into the bundle and isPlausibleUpdate looks for.
const versionLine = (version) => `const VERSION = '${version}';`;

// 1 if a is newer, -1 if older, 0 if equal; null if either isn't a plain x.y.z version.
function compareVersions(a, b) {
  const [pa, pb] = [parseVersion(a), parseVersion(b)];
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

// version.json text to { version, notes }; null if it isn't valid.
function parseManifest(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return null;
  }
  if (!json || typeof json !== 'object' || !isVersion(json.version)) return null;
  return { version: json.version, notes: typeof json.notes === 'string' ? json.notes : '' };
}

// At most one check a day. A last check in the future means the clock changed, so check again.
function shouldCheckForUpdate(lastChecked, now) {
  const last = toMs(lastChecked);
  if (!Number.isFinite(last)) return true;
  const elapsed = toMs(now) - last;
  return elapsed < 0 || elapsed >= UPDATE_CHECK_EVERY;
}

// Raw GitHub URLs for a widget's manifest and built script, or null if any part is malformed.
// repo: owner/repo. widget: the folder under widgets/. script: the output filename in dist/.
function updateUrl(repo, widget, script) {
  if (typeof repo !== 'string' || !REPO_PATTERN.test(repo) || repo.includes('..')) return null;
  if (typeof widget !== 'string' || !WIDGET_PATTERN.test(widget)) return null;
  if (typeof script !== 'string' || !SCRIPT_PATTERN.test(script) || script === '.js' || script.startsWith('..')) return null;
  const base = `https://raw.githubusercontent.com/${repo}/${RELEASE_BRANCH}`;
  return {
    manifest: `${base}/widgets/${widget}/version.json`,
    script: `${base}/dist/${encodeURIComponent(script)}`,
  };
}

// Sanity checks on a downloaded script before it replaces the installed one.
function isPlausibleUpdate(source, expectedVersion, currentVersion) {
  const fail = (reason) => ({ ok: false, reason });
  if (typeof source !== 'string' || !source.trim()) return fail('The download was empty.');
  if (!source.startsWith(SCRIPTABLE_HEADER)) return fail("The download isn't a Scriptable script.");
  const newer = compareVersions(expectedVersion, currentVersion);
  if (newer === null) return fail('A version number was malformed.');
  if (newer <= 0) return fail(`${expectedVersion} isn't newer than the installed ${currentVersion}.`);
  if (!source.includes(`\n${versionLine(expectedVersion)}\n`)) {
    return fail(`The download's version doesn't match ${expectedVersion}.`);
  }
  return { ok: true };
}

module.exports = {
  compareVersions, parseManifest, shouldCheckForUpdate, updateUrl, isPlausibleUpdate,
  isVersion, versionLine, SCRIPTABLE_HEADER,
};
