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
const { DailyAutomation } = require('../schedules/daily-automation');
const { Logger } = require('../utils/logger');
const { TelegramNotifier } = require('../utils/telegram-notifier');

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
    studioMonitor: new YouTubeStudioAnalyticsMonitorAgent(db, credentialManager)
  };

  for (const [name, agent] of Object.entries(agents)) {
    await agent.initialize();
    logger.info(`✓ ${name} agent initialized`);
  }

  const dailyAutomation = new DailyAutomation(agents, db);
  await dailyAutomation.runDailyContentGeneration();
  await dailyAutomation.processPublishQueue(true);
  await dailyAutomation.retryFailedPublishes();

  const telegram = new TelegramNotifier();
  await telegram.sendMessage('🎬 <b>Viral Video Factory Run Finished!</b>\n\nDaily batch (1 long-form + 3 Shorts) successfully generated & published live on YouTube!');

  logger.success('✅ Serverless GitHub Actions Video Generation Pipeline Finished!');
  process.exit(0);
}

runStandaloneAutomation().catch(async (err) => {
  logger.error('❌ GitHub Actions Pipeline Error:', err.message);
  const telegram = new TelegramNotifier();
  await telegram.notifyError({ stage: 'GitHub Actions Batch Run', error: err.message });
  process.exit(1);
});
