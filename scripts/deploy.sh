#!/bin/sh
# Builds every widget and copies dist/ into the iCloud Scriptable folder, where it syncs to the phone.
# Only useful on a Mac signed in to the same iCloud account as the phone.
# Usage: sh scripts/deploy.sh   (or npm run deploy)
set -eu

cd "$(dirname "$0")/.."
DEST="$HOME/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents"

if [ ! -d "$DEST" ]; then
  echo "Scriptable iCloud folder not found: $DEST" >&2
  echo "Open Scriptable on a device signed in to the same iCloud account first." >&2
  exit 1
fi

node scripts/build.js
for f in dist/*.js; do
  cp "$f" "$DEST/"
  echo "deployed $(basename "$f")"
done
