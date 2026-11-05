const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { isStale, formatUpdated, formatSgtTime, toMs } = require('../time.js');

const HOUR = 3600e3;
// Epoch ms for a Singapore wall-clock time, e.g. sgt('2026-10-24T15:00:00').
const sgt = (iso) => new Date(`${iso}+08:00`).getTime();

describe('toMs', () => {
  test('passes numbers through and converts Dates', () => {
    assert.equal(toMs(5), 5);
    assert.equal(toMs(new Date(5)), 5);
  });
});

// Moved from SG Haze, which uses a 2-hour limit.
describe('isStale with a 120-minute limit', () => {
  const now = sgt('2026-10-24T15:39:00');

  test('fresh data is not stale', () => {
    assert.equal(isStale(sgt('2026-10-24T15:00:00'), now, 120), false);
  });

  test('exactly 2 hours old is not stale; 1 ms more is', () => {
    assert.equal(isStale(now - 2 * HOUR, now, 120), false);
    assert.equal(isStale(now - 2 * HOUR - 1, now, 120), true);
  });

  test('accepts Dates as well as epoch ms', () => {
    assert.equal(isStale(new Date(now - 3 * HOUR), new Date(now), 120), true);
  });

  test('missing or invalid time counts as stale', () => {
    assert.equal(isStale(null, now, 120), true);
    assert.equal(isStale(undefined, now, 120), true);
    assert.equal(isStale(NaN, now, 120), true);
  });

  test('a time in the future is not stale', () => {
    assert.equal(isStale(now + HOUR, now, 120), false);
  });
});

describe('isStale with other limits', () => {
  const now = sgt('2026-10-24T15:39:00');

  test('the limit is in minutes, with the boundary on both sides', () => {
    assert.equal(isStale(now - 15 * 60e3, now, 15), false);
    assert.equal(isStale(now - 15 * 60e3 - 1, now, 15), true);
    assert.equal(isStale(now - 14 * 60e3, now, 15), false);
  });

  test('a limit of 0 means anything older than now is stale', () => {
    assert.equal(isStale(now, now, 0), false);
    assert.equal(isStale(now - 1, now, 0), true);
  });

  test('a missing, negative or non-numeric limit counts as stale', () => {
    for (const limit of [undefined, null, -1, NaN, '120', Infinity]) {
      assert.equal(isStale(now, now, limit), true, `limit: ${limit}`);
    }
  });

  test('works across Singapore midnight, when the UTC date differs', () => {
    // 23:50 SGT on the 24th is 15:50 UTC on the 24th; 00:10 SGT on the 25th is 16:10 UTC on the 24th.
    assert.equal(isStale(sgt('2026-10-24T23:50:00'), sgt('2026-10-25T00:10:00'), 30), false);
    assert.equal(isStale(sgt('2026-10-24T23:30:00'), sgt('2026-10-25T00:10:00'), 30), true);
  });
});

// Moved from SG Haze.
describe('formatUpdated', () => {
  test('shows the Singapore reading time as h:mmam/pm', () => {
    assert.equal(formatUpdated(sgt('2026-10-24T15:00:00')), 'Updated 3:00pm');
    assert.equal(formatUpdated(sgt('2026-10-24T09:05:00')), 'Updated 9:05am');
  });

  test('handles midnight and noon', () => {
    assert.equal(formatUpdated(sgt('2026-10-24T00:00:00')), 'Updated 12:00am');
    assert.equal(formatUpdated(sgt('2026-10-24T12:00:00')), 'Updated 12:00pm');
  });

  test('uses Singapore time whatever the UTC date', () => {
    // 16:30 UTC is 00:30 SGT the next day.
    assert.equal(formatUpdated(new Date('2026-10-24T16:30:00Z')), 'Updated 12:30am');
  });

  test('either side of Singapore midnight: 15:59 UTC is 11:59pm, 16:00 UTC is 12:00am', () => {
    assert.equal(formatUpdated(new Date('2026-10-24T15:59:00Z')), 'Updated 11:59pm');
    assert.equal(formatUpdated(new Date('2026-10-24T16:00:00Z')), 'Updated 12:00am');
  });

  test('returns an empty string for a missing or invalid time', () => {
    for (const t of [null, undefined, NaN]) assert.equal(formatUpdated(t), '');
  });
});

describe('formatSgtTime', () => {
  test('returns the bare time, or null when there is none', () => {
    assert.equal(formatSgtTime(sgt('2026-10-24T15:15:00')), '3:15pm');
    assert.equal(formatSgtTime(null), null);
  });
});
