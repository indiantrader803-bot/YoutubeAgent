const { Logger } = require('../utils/logger');
const { TelegramNotifier } = require('../utils/telegram-notifier');

class DedicatedYouTubeAutomationMonitorAgent {
  constructor(db, credentials) {
    this.db = db;
    this.credentials = credentials;
    this.logger = new Logger('DedicatedYouTubeAutomationMonitor');
    this.telegram = new TelegramNotifier();
    this.systemMetrics = {
      totalVideosGenerated: 0,
      totalVideosUploaded: 0,
      totalErrorsLogged: 0,
      lastHeartbeat: Date.now(),
      status: 'HEALTHY'
    };
  }

  async initialize() {
    this.logger.info('🛡️ Dedicated YouTube Automation System Overseer Agent Initialized');
    this.start247Heartbeat();
    return true;
  }

  start247Heartbeat() {
    // Send health status ping every 6 hours
    setInterval(() => {
      this.systemMetrics.lastHeartbeat = Date.now();
      this.logger.info(`[YouTubeOverseer] 24/7 Automation Health Ping. Generated: ${this.systemMetrics.totalVideosGenerated}, Uploaded: ${this.systemMetrics.totalVideosUploaded}`);
    }, 6 * 60 * 60 * 1000);
  }

  logVideoGenerated(topic, format) {
    this.systemMetrics.totalVideosGenerated++;
    this.logger.info(`[YouTubeOverseer] Video generated: "${topic}" [Format: ${format}]`);
  }

  logVideoUploaded(videoId, title, url) {
    this.systemMetrics.totalVideosUploaded++;
    this.logger.success(`[YouTubeOverseer] Video successfully published to YouTube BROblox: ${url}`);
    
    this.telegram.sendMessage(`🚀 <b>[YouTube System Overseer] Live Video Upload Alert!</b>\n\n<b>Title:</b> ${title}\n<b>Video ID:</b> ${videoId}\n<b>Live URL:</b> ${url}\n\n<b>Total Channel Uploads:</b> ${this.systemMetrics.totalVideosUploaded}`);
  }

  logSystemError(stage, errorMsg) {
    this.systemMetrics.totalErrorsLogged++;
    this.systemMetrics.status = 'WARNING';
    this.logger.error(`[YouTubeOverseer] Automation issue detected during ${stage}: ${errorMsg}`);
  }

  getSystemStatus() {
    return {
      ...this.systemMetrics,
      uptimeSec: Math.round(process.uptime())
    };
  }
}

module.exports = { DedicatedYouTubeAutomationMonitorAgent };
