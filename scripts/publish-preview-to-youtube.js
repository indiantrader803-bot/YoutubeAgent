#!/usr/bin/env node
/**
 * Publishes the videos produced by scripts/generate-preview-videos.js to the
 * connected YouTube channel, using the real scheduling/publishing agent.
 *
 * Usage:
 *   node scripts/publish-preview-to-youtube.js            # uses DEFAULT_PRIVACY_STATUS
 *   node scripts/publish-preview-to-youtube.js --public   # forces public
 *   node scripts/publish-preview-to-youtube.js --private  # forces private
 *
 * Already-published productions are skipped so re-running can't create
 * duplicate uploads.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { Database } = require('../database/db');
const { CredentialManager } = require('../utils/credential-manager');
const { PublishingSchedulingAgent } = require('../agents/publishing-scheduling-agent');
const { Logger } = require('../utils/logger');

const logger = new Logger('PublishExisting');
const ROOT = path.join(__dirname, '..');
const RESULTS = path.join(ROOT, 'scratch', 'preview-results.json');
// index 0 is the Short, index 1 is the long-form (see generate-preview-videos.js)
const IS_SHORT = { 0: true, 1: false };

function parsePrivacy() {
  const args = process.argv.slice(2);
  if (args.includes('--public')) return 'public';
  if (args.includes('--private')) return 'private';
  return process.env.DEFAULT_PRIVACY_STATUS || 'private';
}

/** Rebuilds the productionData shape the publishing agent expects. */
function buildProductionData(item, index) {
  const isShort = IS_SHORT[index] ?? false;
  const videoPath = item.videoPath;
  const captionsPath = path.join(ROOT, 'data', 'captions', `${item.id}_captions.srt`);

  return {
    id: item.id,
    isShort,
    priority: isShort ? 60 : 50,
    scheduledPublishTime: new Date().toISOString(),
    script: { title: item.title },
    seo: {
      title: item.title,
      description: item.seo?.description || '',
      tags: item.seo?.tags || []
    },
    assets: {
      finalVideo: { path: videoPath, simulated: false },
      thumbnail: item.thumbnailPath,
      captions: fs.existsSync(captionsPath) ? { path: captionsPath } : null
    }
  };
}

async function main() {
  const privacy = parsePrivacy();
  // The publishing agent reads this env var at upload time, so the CLI flag has
  // to be written back into the environment, not just held in a local.
  process.env.DEFAULT_PRIVACY_STATUS = privacy;

  if (!fs.existsSync(RESULTS)) {
    logger.error(`No results file at ${RESULTS}. Run scripts/generate-preview-videos.js first.`);
    process.exit(1);
  }

  const results = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
  const publishable = results
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item && item.videoPath && !item.error && fs.existsSync(item.videoPath));

  if (!publishable.length) {
    logger.error('No publishable videos found in the results file (missing videoPath).');
    process.exit(1);
  }

  const db = new Database();
  await db.initialize();

  const credentialManager = new CredentialManager();
  await credentialManager.initialize();

  const publishing = new PublishingSchedulingAgent(db, credentialManager);
  await publishing.initialize();

  if (!publishing.youtube) {
    logger.error('YouTube API not authenticated. Complete the OAuth consent flow first.');
    process.exit(1);
  }

  logger.info(`Uploading to YouTube with privacy="${privacy}"`);

  let uploaded = 0;
  let skipped = 0;

  for (const { item, index } of publishable) {
    const isShort = IS_SHORT[index] ?? false;
    const label = isShort ? 'Short 9:16' : 'Long-form 16:9';

    const existing = await db.getAllRows(
      'SELECT youtube_id, youtube_url, status FROM publish_schedule WHERE production_id = ? ORDER BY created_at DESC LIMIT 1',
      [item.id]
    ).catch(() => []);
    const row = existing[0];

    if (row && row.youtube_id) {
      logger.warn(`[${label}] Already uploaded (${row.youtube_url}) — skipping to avoid a duplicate.`);
      skipped++;
      continue;
    }

    logger.info(`[${label}] Uploading "${item.title}"...`);

    try {
      const productionData = buildProductionData(item, index);
      const scheduleEntry = await publishing.scheduleContent(productionData);
      if (scheduleEntry) {
        // Persisted into publish_schedule metadata so the uploader knows the format.
        scheduleEntry.isShort = isShort;
        scheduleEntry.metadata.isShort = isShort;
      }

      const published = await publishing.publishContent(productionData.id);
      if (published?.youtubeUrl) {
        logger.success(`[${label}] ✅ ${published.youtubeUrl}`);
        uploaded++;
      } else {
        logger.error(`[${label}] Upload finished but returned no URL.`);
      }
    } catch (error) {
      logger.error(`[${label}] Upload failed: ${error.message}`);
    }
  }

  logger.info(`Done — ${uploaded} uploaded, ${skipped} skipped.`);
  process.exit(0);
}

main().catch((error) => {
  logger.error('Publish run failed:', error.message);
  process.exit(1);
});
