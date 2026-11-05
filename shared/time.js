// Time helpers shared by widgets. Pure: callers pass `now` in, nothing reads the clock.

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const SGT_OFFSET = 8 * HOUR; // Singapore is UTC+8 with no daylight saving

const toMs = (t) => (t instanceof Date ? t.getTime() : t);

// True if latestTime is more than maxAgeMinutes before now. A missing or invalid time, or a
// missing or invalid limit, counts as stale. A time in the future is not stale.
function isStale(latestTime, now, maxAgeMinutes) {
  const time = toMs(latestTime);
  if (!Number.isFinite(time)) return true;
  if (typeof maxAgeMinutes !== 'number' || !Number.isFinite(maxAgeMinutes) || maxAgeMinutes < 0) return true;
  return toMs(now) - time > maxAgeMinutes * 60e3;
}

// Singapore wall-clock time as "3:00pm", or null for a missing or invalid time.
function formatSgtTime(time) {
  const ms = toMs(time);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + SGT_OFFSET);
  const h = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${mm}${h < 12 ? 'am' : 'pm'}`;
}

// "Updated 3:00pm", or '' for a missing or invalid time.
function formatUpdated(time) {
  const t = formatSgtTime(time);
  return t ? `Updated ${t}` : '';
}

module.exports = {
  HOUR, DAY, SGT_OFFSET, toMs, isStale, formatSgtTime, formatUpdated,
};
