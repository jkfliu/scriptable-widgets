# Changelog

## 1.1.0 (2026-11-05)

Moved into the scriptable-widgets repo. No change to how the widget looks or works.

- Update checks now read `widgets/sg-haze/version.json` and download `dist/SG Haze.js` from github.com/jkfliu/scriptable-widgets.
- Time formatting, staleness, the update checker, and the file cache and Keychain helpers now come from the repo's shared code.

## 1.0.0 (2026-10-24)

First release.

- Small, medium and lock screen (rectangular) widgets for one Singapore region, set by the widget's Parameter.
- Latest 1-hour PM2.5 and 24-hour PSI, each with its NEA band.
- Chart of 1-hour PM2.5 over the last 24 hours: a black line over NEA's four PM2.5 band colours, with breaks where hours are missing.
- Shows saved readings marked "stale" when data.gov.sg can't be reached.
- Optional data.gov.sg API key, stored in the Keychain.
- Daily update check against github.com/jkfliu/sg-haze-widget. On by default and can be turned off in the app. Updates install only when you tap Install.
