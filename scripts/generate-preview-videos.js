// Generate one Short + one Long-Form video through the REAL pipeline for visual preview.
// No YouTube upload — videos and assets stay local.
//
// Usage:
//   node scripts/generate-preview-videos.js            # both formats
//   node scripts/generate-preview-videos.js short      # only the 9:16 Short
//   node scripts/generate-preview-videos.js long       # only the 16:9 long-form
//
// Generating a single format keeps the other entry from the previous run so the
// preview page always shows one of each.
require('dotenv').config();

const { Database } = require('../database/db');
const { CredentialManager } = require('../utils/credential-manager');
const { ContentStrategyAgent } = require('../agents/content-strategy-agent');
const { ScriptWriterAgent } = require('../agents/script-writer-agent');
const { ThumbnailDesignerAgent } = require('../agents/thumbnail-designer-agent');
const { SEOOptimizerAgent } = require('../agents/seo-optimizer-agent');
const { ProductionManagementAgent } = require('../agents/production-management-agent');
const { Logger } = require('../utils/logger');

const logger = new Logger('PreviewGeneration');

async function generateOne(agents, niche, type, isShort) {
  const formatLabel = isShort ? 'Short (9:16)' : 'Long-Form (16:9)';
  logger.info(`\n=== Generating ${formatLabel}: ${niche} ===`);

  const strategy = await agents.strategy.generateContentStrategy(niche);
  strategy.contentType = type;
  strategy.isShort = isShort;
  logger.info(`Topic: ${strategy.topic}`);

  const script = await agents.scriptWriter.generateScript(strategy);
  logger.info(`Title: ${script.title}`);

  const thumbnail = await agents.thumbnailDesigner.generateThumbnail(script);
  logger.info(`Thumbnail: ${thumbnail.path}`);

  const seoData = await agents.seoOptimizer.optimize(script, strategy);
  logger.info(`SEO tags: ${(seoData.tags || []).slice(0, 8).join(', ')}`);

  const productionData = await agents.production.processContent({
    strategy,
    script,
    thumbnail,
    seo: seoData,
    isShort
  });
  productionData.isShort = isShort;

  const video = productionData.assets?.finalVideo;
  const simulated = !video || video.simulated;
  logger.info(simulated
    ? `⚠️ No real video produced (simulated): ${JSON.stringify(video || {})}`
    : `✅ Video ready: ${video.path} (${Math.round((video.fileSize || 0) / 1024 / 1024)} MB)`);

  return {
    topic: strategy.topic,
    title: script.title,
    thumbnailPath: thumbnail.path,
    seo: { title: seoData.title, tags: seoData.tags, description: (seoData.description || '').slice(0, 300) },
    videoPath: simulated ? null : (productionData.assets.finalVideo?.path || video.path),
    simulated,
    id: productionData.id
  };
}

async function main() {
  const db = new Database();
  await db.initialize();

  const credentialManager = new CredentialManager();
  await credentialManager.initialize();

  const agents = {
    strategy: new ContentStrategyAgent(db, credentialManager),
    scriptWriter: new ScriptWriterAgent(db, credentialManager),
    thumbnailDesigner: new ThumbnailDesignerAgent(db, credentialManager),
    seoOptimizer: new SEOOptimizerAgent(db, credentialManager),
    production: new ProductionManagementAgent(db, credentialManager)
  };

  for (const [name, agent] of Object.entries(agents)) {
    await agent.initialize();
    logger.info(`✓ ${name} ready`);
  }

  const wanted = (process.argv[2] || 'both').toLowerCase();
  const doShort = wanted === 'both' || wanted === 'short';
  const doLong = wanted === 'both' || wanted === 'long';

  // Preserve the untouched format from the previous run.
  let previous = [];
  try {
    previous = JSON.parse(require('fs').readFileSync('scratch/preview-results.json', 'utf8'));
  } catch { /* no previous results */ }

  const results = [];

  // Short: animation niche from today's rotation slot
  const animationNiches = [
    '2D Cartoon Storytime: School Backbencher Comedy (Not Your Type Style)',
    '2D Cartoon Storytime: Strict Teacher vs Clever Student (Animation)',
    '2D Cartoon Storytime: Exam Day Disasters (Comedy Animation)'
  ];
  const tradingNiches = [
    'Candlestick Chart Pattern Breakdown: Pin Bar Strategy (Easy Trading Style)',
    'Support & Resistance Entry Secrets (Candlestick Analysis)',
    'How to Spot False Breakouts Before They Trap You (Trading Strategy)'
  ];
  const slot = Math.floor(Date.now() / 43200000);

  if (doShort) {
    try {
      results[0] = await generateOne(agents, animationNiches[slot % animationNiches.length], 'animation', true);
    } catch (err) {
      logger.error(`Short generation failed: ${err.message}`);
      results[0] = { error: `Short: ${err.message}` };
    }
  } else if (previous[0]) {
    results[0] = previous[0];
    logger.info('Keeping previous Short result (not regenerated)');
  }

  if (doLong) {
    try {
      results[1] = await generateOne(agents, tradingNiches[slot % tradingNiches.length], 'tutorial', false);
    } catch (err) {
      logger.error(`Long-form generation failed: ${err.message}`);
      results[1] = { error: `Long-form: ${err.message}` };
    }
  } else if (previous[1]) {
    results[1] = previous[1];
    logger.info('Keeping previous long-form result (not regenerated)');
  }

  const fs = require('fs');
  fs.writeFileSync('scratch/preview-results.json', JSON.stringify(results, null, 2));
  logger.info('Preview generation complete — results written to scratch/preview-results.json');
  process.exit(0);
}

main().catch(err => {
  logger.error('Preview generation failed:', err.message);
  process.exit(1);
});
