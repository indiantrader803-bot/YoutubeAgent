require('dotenv').config();

const { Database } = require('../database/db');
const { CredentialManager } = require('../utils/credential-manager');
const { ContentStrategyAgent } = require('../agents/content-strategy-agent');
const { ScriptWriterAgent } = require('../agents/script-writer-agent');
const { ThumbnailDesignerAgent } = require('../agents/thumbnail-designer-agent');
const { SEOOptimizerAgent } = require('../agents/seo-optimizer-agent');
const { ProductionManagementAgent } = require('../agents/production-management-agent');
const { PublishingSchedulingAgent } = require('../agents/publishing-scheduling-agent');
const { AnalyticsOptimizationAgent } = require('../agents/analytics-optimization-agent');
const { VideoGenerationMonitorAgent } = require('../agents/video-generation-monitor-agent');
const { DedicatedYouTubeAutomationMonitorAgent } = require('../agents/youtube-automation-monitor-agent');
const { YouTubeStudioAnalyticsMonitorAgent } = require('../agents/youtube-studio-analytics-monitor-agent');
const { VideoQualityControlAgent } = require('../agents/video-quality-control-agent');
const { ChannelMaintenanceAgent } = require('../agents/channel-maintenance-agent');
const { DailyAutomation } = require('../schedules/daily-automation');
const { getRunIndex } = require('../config/content-matrix');
const { Logger } = require('../utils/logger');
const { TelegramNotifier } = require('../utils/telegram-notifier');
const { EmailNotifier } = require('../utils/email-notifier');

const logger = new Logger('GitHubWorkflowRunner');

async function runStandaloneAutomation() {
  logger.info('🚀 Starting 100% Serverless GitHub Actions Video Automation Pipeline...');

  const db = new Database();
  await db.initialize();

  const credentialManager = new CredentialManager();
  await credentialManager.initialize();

  const creds = credentialManager.credentials || {};

  const agents = {
    strategy: new ContentStrategyAgent(db, credentialManager),
    scriptWriter: new ScriptWriterAgent(db, credentialManager),
    thumbnailDesigner: new ThumbnailDesignerAgent(db, credentialManager),
    seoOptimizer: new SEOOptimizerAgent(db, credentialManager),
    production: new ProductionManagementAgent(db, credentialManager),
    publishing: new PublishingSchedulingAgent(db, credentialManager),
    analytics: new AnalyticsOptimizationAgent(db, credentialManager),
    videoMonitor: new VideoGenerationMonitorAgent(db, credentialManager),
    youtubeOverseer: new DedicatedYouTubeAutomationMonitorAgent(db, credentialManager),
    studioMonitor: new YouTubeStudioAnalyticsMonitorAgent(db, credentialManager),
    qualityControl: new VideoQualityControlAgent(db, credentialManager),
    channelMaintenance: new ChannelMaintenanceAgent(db, credentialManager)
  };

  for (const [name, agent] of Object.entries(agents)) {
    await agent.initialize();
    logger.info(`✓ ${name} agent initialized`);
  }

  const dailyAutomation = new DailyAutomation(agents, db);

  // Agnes is a free real-render engine (vendored in vendor/agnes-video-generator):
  // when AGNES_API_KEY is set, its service is brought up so production can use
  // it; without a key the pipeline behaves exactly as before (FFmpeg chain).
  let agnesUp = false;
  try {
    agnesUp = await dailyAutomation.ensureAgnesService();
  } catch (agnesErr) {
    logger.warn(`Agnes service startup skipped: ${agnesErr.message}`);
  }
  if (!agnesUp) {
    logger.info('Agnes renderer not enabled (set AGNES_API_KEY to activate it).');
  }

  // ── Pre-flight: YouTube credential check ──────────────────────────────────
  // Fails BEFORE spending render time when the runner has no working YouTube
  // auth, and emails the owner the exact recovery steps. Recovery is a
  // one-time GitHub-secrets update; until then the run exits red immediately.
  const email = new EmailNotifier();
  try {
    const auth = credentialManager.getYouTubeAuth();
    // Force a token refresh so a dead refresh token is caught here, not
    // mid-upload (googleapis refreshes lazily on first API call).
    await Promise.race([
      auth.getAccessToken(),
      new Promise((_res, rej) => setTimeout(() => rej(new Error('credential check timed out')), 30000))
    ]);
    logger.info('✓ YouTube credentials verified (refresh OK)');
  } catch (credErr) {
    logger.error(`YouTube credentials not usable in this environment: ${credErr.message}`);
    await email.sendManualActionNeeded(
      'YouTube login expired — videos are NOT being published',
      [
        'Open the repo on GitHub → Settings → Secrets and variables → Actions.',
        'Set/refresh these 3 secrets from your local config files:',
        '   • YOUTUBE_CLIENT_ID      ← config/credentials.json → youtube.client_id',
        '   • YOUTUBE_CLIENT_SECRET  ← config/credentials.json → youtube.client_secret',
        '   • YOUTUBE_REFRESH_TOKEN  ← config/tokens.json → youtube.refresh_token',
        '(Keep them private — never commit them to the code.)',
        'Then open the Actions tab → "24/7 Serverless Daily Video Automation" → Re-run all jobs.',
        'Note: if your Google OAuth app is in Testing mode, refresh tokens expire every 7 days.',
        ' To stop the weekly re-auth cycle forever: publish the app to production',
        ' (Google Cloud Console → APIs & Services → OAuth consent screen → Publish app).'
      ]
    ).catch(() => {});
    const telegram = new TelegramNotifier();
    await telegram.sendMessage('🚨 <b>YouTube credentials invalid on the runner</b> — nothing can be published until the repo secrets are refreshed. Check your email for exact steps.').catch(() => {});
    process.exit(1);
  }

  // ── Scheduled channel maintenance ─────────────────────────────────────────
  // Theme pack rotates monthly (by run index ≈ 12h, so ~15 runs ≈ 7.5 days;
  // the modulo makes any cadence safe), health audit weekly, policy hygiene
  // weekly. All failures degrade to warnings — maintenance must never block
  // the daily content batch.
  const maintenance = agents.channelMaintenance;
  if (maintenance) {
    const runIdx = getRunIndex();
    await maintenance.refreshChannelTheme(runIdx)
      .catch(err => logger.warn(`Theme refresh skipped: ${err.message}`));
    if (runIdx % 14 === 0) {
      await maintenance.runWeeklyHealthAudit(agents.publishing)
        .catch(err => logger.warn(`Health audit skipped: ${err.message}`));
      await maintenance.runPolicyHygieneSweep()
        .catch(err => logger.warn(`Policy hygiene skipped: ${err.message}`));
    }
  }

  let generationFailed = false;
  try {
    await dailyAutomation.runDailyContentGeneration();
  } catch (genErr) {
    // The batch already escalated (Telegram alert + verdict). Keep going:
    // queued entries from earlier runs still deserve a publish attempt and
    // the failed-publish retry pass.
    generationFailed = true;
    logger.error(`Daily batch failed: ${genErr.message}`);
  }

  // Always run the queue + retry passes — even after a failed batch — so a
  // transient upload error or an entry from an earlier failed run still
  // reaches YouTube instead of silently expiring in the database.
  try {
    await dailyAutomation.processPublishQueue(true);
  } catch (queueErr) {
    logger.error(`Publish queue processing failed: ${queueErr.message}`);
  }
  try {
    await dailyAutomation.retryFailedPublishes();
  } catch (retryErr) {
    logger.error(`Retry pass failed: ${retryErr.message}`);
  }

  // ── Run verdict → exit code ────────────────────────────────────────────
  // The permanent fix for "workflow green but nothing published": this script
  // computes the REAL outcome from the publish_schedule table and exits
  // non-zero when nothing got published today, so GitHub Actions marks the
  // run red and the Telegram alert fires.
  let publishedToday = 0;
  try {
    const rows = await db.getAllRows(
      "SELECT COUNT(*) AS n FROM publish_schedule WHERE status = 'published' AND published_at >= datetime('now', '-1 day')"
    );
    publishedToday = rows[0]?.n || 0;
  } catch (countErr) {
    logger.warn(`Could not count today's publishes: ${countErr.message}`);
  }

  const telegram = new TelegramNotifier();
  if (publishedToday > 0) {
    await telegram.sendMessage(
      `🎬 <b>Viral Video Factory Run Finished!</b>\n\nToday's uploads: <b>${publishedToday}</b> video(s) live or scheduled on YouTube.${generationFailed ? '\n\n⚠️ (the generation batch itself reported an error — check the Actions log)' : ''}`
    ).catch(() => {});
    logger.success(`✅ Pipeline finished — ${publishedToday} video(s) published/scheduled today`);
    process.exit(generationFailed ? 1 : 0);
  }

  const failMsg = generationFailed
    ? 'The generation batch crashed before any video reached the publish queue.'
    : 'The batch completed but produced no publishable real video (simulated renders are rejected, never uploaded).';
  await telegram.sendMessage(
    `🚨 <b>DAILY AUTOMATION DID NOT PUBLISH</b>\n\n${failMsg}\n\nCheck the GitHub Actions log of the latest run for the batch verdict and fix the environment (AGNES_API_KEY / AI keys / FFmpeg).`
  ).catch(() => {});

  logger.error(`❌ Pipeline finished with NOTHING published today (generationFailed=${generationFailed})`);
  process.exit(1);
}

runStandaloneAutomation().catch(async (err) => {
  logger.error('❌ GitHub Actions Pipeline Error:', err.message);
  const telegram = new TelegramNotifier();
  await telegram.notifyError({ stage: 'GitHub Actions Batch Run', error: err.message });
  process.exit(1);
});
