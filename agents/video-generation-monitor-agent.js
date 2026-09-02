const { Logger } = require('../utils/logger');
const { TelegramNotifier } = require('../utils/telegram-notifier');

class VideoGenerationMonitorAgent {
  constructor(db, credentials) {
    this.db = db;
    this.credentials = credentials;
    this.logger = new Logger('VideoGenerationMonitorAgent');
    this.telegram = new TelegramNotifier();
    this.activeJobs = new Map();
  }

  async initialize() {
    this.logger.info('🔍 Video Generation Process Monitor Agent Initialized');
    return true;
  }

  trackProcess(contentId, topic, stage = 'started') {
    const record = {
      contentId,
      topic,
      stage,
      startedAt: Date.now(),
      status: 'in_progress',
      checkpoints: [{ stage, timestamp: Date.now() }]
    };
    this.activeJobs.set(contentId, record);
    this.logger.info(`[VideoMonitor] Started tracking video generation process: ${contentId} ("${topic}")`);
  }

  updateStage(contentId, newStage, details = {}) {
    if (!this.activeJobs.has(contentId)) return;
    const record = this.activeJobs.get(contentId);
    record.stage = newStage;
    record.checkpoints.push({ stage: newStage, timestamp: Date.now(), ...details });
    this.logger.info(`[VideoMonitor] Stage updated for ${contentId}: ${newStage}`);
  }

  markCompleted(contentId, assetPath) {
    if (!this.activeJobs.has(contentId)) return;
    const record = this.activeJobs.get(contentId);
    record.status = 'completed';
    record.completedAt = Date.now();
    record.durationSec = Math.round((record.completedAt - record.startedAt) / 1000);
    record.assetPath = assetPath;
    this.logger.success(`[VideoMonitor] Video generation successfully completed in ${record.durationSec}s: ${contentId}`);
    
    // Notify Telegram
    this.telegram.sendMessage(`🎬 <b>[Video Monitor Agent] Render Complete!</b>\n\n<b>Topic:</b> ${record.topic}\n<b>Duration:</b> ${record.durationSec}s\n<b>Status:</b> Ready for YouTube Upload`);
  }

  markFailed(contentId, errorMsg) {
    if (!this.activeJobs.has(contentId)) return;
    const record = this.activeJobs.get(contentId);
    record.status = 'failed';
    record.error = errorMsg;
    this.logger.error(`[VideoMonitor] Video generation failed for ${contentId}: ${errorMsg}`);
    
    this.telegram.sendMessage(`⚠️ <b>[Video Monitor Agent] Generation Failure Alert!</b>\n\n<b>Topic:</b> ${record.topic}\n<b>Error:</b> ${errorMsg}`);
  }

  getHealthSummary() {
    const total = this.activeJobs.size;
    let completed = 0, failed = 0, inProgress = 0;
    this.activeJobs.forEach(job => {
      if (job.status === 'completed') completed++;
      else if (job.status === 'failed') failed++;
      else inProgress++;
    });

    return { total, completed, failed, inProgress };
  }
}

module.exports = { VideoGenerationMonitorAgent };
