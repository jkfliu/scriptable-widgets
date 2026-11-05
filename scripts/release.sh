#!/bin/sh
# Releases one widget: checks the version is newer than its last release, runs the tests, sets
# the version in widget.json, builds the widget into dist/, scans the bundle for secrets, and writes
# the widget's version.json, which the update checker reads from GitHub.
# Usage: sh scripts/release.sh <widget> <version> "<release notes>"
#   e.g. sh scripts/release.sh market-prices 1.0.1 "Fixes the closed marker"
# RELEASE_TEST_CMD replaces `npm test` (the release tests use it so the suite doesn't run itself).
set -eu

cd "$(dirname "$0")/.."

if [ $# -ne 3 ]; then
  echo 'usage: sh scripts/release.sh <widget> <version> "<release notes>"' >&2
  exit 2
fi
WIDGET=$1
VERSION=$2
NOTES=$3
DIR="widgets/$WIDGET"

if [ ! -f "$DIR/widget.json" ]; then
  echo "no widget called $WIDGET (expected $DIR/widget.json)" >&2
  exit 1
fi

# Must be x.y.z and newer than the last release in version.json, if there is one.
node -e '
const fs = require("node:fs");
const { compareVersions, isVersion, parseManifest } = require("./shared/update.js");
const [dir, next] = process.argv.slice(1);
if (!isVersion(next)) {
  console.error(`not an x.y.z version: ${next}`);
  process.exit(1);
}
const file = `${dir}/version.json`;
const last = fs.existsSync(file) ? parseManifest(fs.readFileSync(file, "utf8"))?.version : null;
if (last && compareVersions(next, last) !== 1) {
  console.error(`${next} is not newer than the last release, ${last}`);
  process.exit(1);
}
' "$DIR" "$VERSION"

sh -c "${RELEASE_TEST_CMD:-npm test}"

node -e '
const fs = require("node:fs");
const [dir, version] = process.argv.slice(1);
const file = `${dir}/widget.json`;
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.version = version;
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
' "$DIR" "$VERSION"

node scripts/build.js "$WIDGET"
OUTPUT=$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).output)' "$DIR/widget.json")
node scripts/check-secrets.js "dist/$OUTPUT"

node -e '
const fs = require("node:fs");
const [dir, version, notes] = process.argv.slice(1);
fs.writeFileSync(`${dir}/version.json`, JSON.stringify({ version, notes }, null, 2) + "\n");
' "$DIR" "$VERSION" "$NOTES"

echo
echo "$WIDGET $VERSION is ready: $DIR/widget.json, $DIR/version.json and dist/$OUTPUT. Next:"
echo "  1. Add a $VERSION entry to $DIR/CHANGELOG.md"
echo "  2. git add -A && git commit -m \"Release $WIDGET $VERSION\" && git tag $WIDGET-v$VERSION"
echo "  3. git push && git push --tags (installs with update checks on see it once it's on main)"
