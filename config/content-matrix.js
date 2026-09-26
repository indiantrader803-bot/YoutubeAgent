// Content matrix: turns the viral-topics database into the daily production batch.
//
// Default daily output: 1 long-form video (8-12 min) + 3 Shorts derived from it
// (hook-twist / myth-bust / countdown angles), rotating across 5 high-RPM
// categories × 50 topics so content never repeats until the pool is exhausted.
//
// Configure via environment variables (see .env.example):
//   CONTENT_TOPICS       – custom topic list, pipe-separated (overrides database)
//   CONTENT_LANGUAGES    – language rotation (default: en only, US-targeted)
//   DAILY_SHORTS         – Shorts per day (default 3)
//   PUBLISH_TIMEZONE     – IANA timezone (default America/New_York)
//   LONG_PUBLISH_HOUR    – hour in that timezone for the long video (default 19)
//   SHORT_PUBLISH_HOURS  – comma hours for Shorts (default 9,13,17)

const { CATEGORIES, DAILY_PLAN, SHORT_ANGLES, UPLOAD_SCHEDULE, TARGET_GEOS } = require('./viral-topics');
const { DEFAULT_LANGUAGES } = require('./language-defaults');

// Flatten the category database into production-ready topic slots.
function buildTopicPool() {
  const pool = [];
  for (const category of CATEGORIES) {
    for (const topic of category.topics) {
      pool.push({
        id: `${category.id}:${topic.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
        title: topic.title,
        categoryId: category.id,
        categoryName: category.name,
        type: category.contentType,
        isShort: false,
        thumbnailColors: category.thumbnailColors,
        thumbnailText: category.thumbnailText,
        niches: [topic.title]
      });
    }
  }
  return pool;
}

function loadContentMatrix() {
  const languages = parseLanguages(process.env.CONTENT_LANGUAGES) || [DEFAULT_LANGUAGES[0]]; // default: English only (US-targeted)
  const plan = {
    longVideosPerDay: DAILY_PLAN.longVideosPerDay,
    shortsPerLong: parseInt(process.env.DAILY_SHORTS, 10) || DAILY_PLAN.shortsPerLong,
    schedule: {
      timezone: process.env.PUBLISH_TIMEZONE || UPLOAD_SCHEDULE.timezone,
      longHour: parseInt(process.env.LONG_PUBLISH_HOUR, 10) || UPLOAD_SCHEDULE.longVideoHourET,
      shortHours: (process.env.SHORT_PUBLISH_HOURS || UPLOAD_SCHEDULE.shortHoursET.join(','))
        .split(',').map(h => parseInt(h.trim(), 10)).filter(h => !Number.isNaN(h))
    }
  };

  let topicPool;
  if (process.env.CONTENT_TOPICS) {
    // Custom topics override the database (pipe-separated).
    const listed = String(process.env.CONTENT_TOPICS).split('|').map(s => s.trim()).filter(Boolean);
    topicPool = listed.map((name, i) => ({
      id: `custom-${i + 1}`,
      title: name,
      categoryId: 'custom',
      categoryName: 'Custom',
      type: i % 2 === 0 ? 'explainer' : 'story',
      isShort: false,
      niches: [name]
    }));
  } else {
    topicPool = buildTopicPool();
  }

  return { topicPool, languages, shortAngles: SHORT_ANGLES, plan, targetGeos: TARGET_GEOS };
}

function parseListEnv(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

function parseLanguages(value) {
  const codes = parseListEnv(value);
  if (codes.length === 0) return null;
  return codes.map(code => {
    const known = DEFAULT_LANGUAGES.find(l => l.code === code.toLowerCase());
    return known || {
      code: code.toLowerCase(),
      name: code.toUpperCase(),
      google: code.toLowerCase(),
      elevenlabs: code.toLowerCase(),
      openai: code.toLowerCase()
    };
  });
}

// Stable run counter: advances every 12 hours of wall-clock time so restarts
// (fresh GitHub Actions runners) cannot reset the rotation.
function getRunIndex() {
  return Math.floor(Date.now() / (12 * 60 * 60 * 1000));
}

// Timezone helpers for US prime-time scheduling --------------------------------

function getTzOffsetMs(instant, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = {};
  for (const x of fmt.formatToParts(instant)) p[x.type] = x.value;
  const wallAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour === '24' ? 0 : p.hour), +p.minute, +p.second);
  return wallAsUtc - instant.getTime();
}

// Convert a wall-clock date in `timeZone` to a UTC instant (DST-safe,
// two-pass offset probe).
function wallToInstant(wallMs, timeZone) {
  let guess = wallMs;
  for (let i = 0; i < 2; i++) {
    guess = wallMs - getTzOffsetMs(new Date(guess), timeZone);
  }
  return new Date(guess);
}

// Next occurrence of `hour`:00 in `timeZone` as ISO string (for publishAt).
function computeBestPublishTime(hour, timezone = UPLOAD_SCHEDULE.timezone) {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  // en-US 2-digit format is MM/DD/YYYY
  const [month, day, year] = fmt.format(now).split('/').map(Number);
  for (let addDays = 0; addDays <= 2; addDays++) {
    const wall = Date.UTC(year, month - 1, day + addDays, hour, 0, 0);
    const instant = wallToInstant(wall, timezone);
    if (instant.getTime() > now.getTime()) {
      return instant.toISOString();
    }
  }
  // Unreachable, but keep a sane fallback.
  return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

// Build the batch for one run: 1 long-form + N Shorts derived from it.
// The long-form topic walks the pool one slot per run (never repeating until
// the pool is exhausted); Shorts reuse the same topic with distinct angles.
function buildDailyBatch(matrix, runIndex) {
  const { topicPool, languages, shortAngles, plan } = matrix;
  const topic = topicPool[runIndex % topicPool.length];
  const language = languages[runIndex % languages.length];

  const batch = [{
    kind: 'long',
    topic,
    niche: topic.niches[0],
    language,
    publishSlot: { hour: plan.schedule.longHour, timezone: plan.schedule.timezone }
  }];

  const shortsCount = Math.min(plan.shortsPerLong, shortAngles.length);
  for (let s = 0; s < shortsCount; s++) {
    const angle = shortAngles[(runIndex + s) % shortAngles.length];
    batch.push({
      kind: 'short',
      topic,
      niche: topic.niches[0],
      angleId: angle.id,
      angleInstruction: angle.instruction,
      derivedFrom: topic.id,
      language,
      publishSlot: {
        hour: plan.schedule.shortHours[s % plan.schedule.shortHours.length],
        timezone: plan.schedule.timezone
      }
    });
  }

  return batch;
}

module.exports = {
  buildTopicPool,
  loadContentMatrix,
  getRunIndex,
  buildDailyBatch,
  computeBestPublishTime,
  DAILY_PLAN,
  UPLOAD_SCHEDULE
};
