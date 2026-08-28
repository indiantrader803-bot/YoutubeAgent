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
    strategy: new ContentStrategyAgent(db, creds),
    scriptWriter: new ScriptWriterAgent(db, creds),
    thumbnailDesigner: new ThumbnailDesignerAgent(db, creds),
    seoOptimizer: new SEOOptimizerAgent(db, creds),
    production: new ProductionManagementAgent(db, creds),
    publishing: new PublishingSchedulingAgent(db, creds),
    analytics: new AnalyticsOptimizationAgent(db, creds)
  };

  for (const [name, agent] of Object.entries(agents)) {
    await agent.initialize();
    logger.info(`✓ ${name} agent initialized`);
  }

  const dailyAutomation = new DailyAutomation(agents, db);
  await dailyAutomation.runDailyContentGeneration();
  await dailyAutomation.processPublishQueue();

  const telegram = new TelegramNotifier();
  await telegram.sendMessage('🎉 <b>GitHub Actions 24/7 Automation Finished!</b>\n\nDaily 5-Video Batch (3 Shorts + 2 Long-Form) successfully generated & uploaded to YouTube!');

  logger.success('✅ Serverless GitHub Actions Video Generation Pipeline Finished!');
  process.exit(0);
}

runStandaloneAutomation().catch(async (err) => {
  logger.error('❌ GitHub Actions Pipeline Error:', err.message);
  const telegram = new TelegramNotifier();
  await telegram.notifyError({ stage: 'GitHub Actions Batch Run', error: err.message });
  process.exit(1);
});
