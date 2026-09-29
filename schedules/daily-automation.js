const cron = require('node-cron');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const { Logger } = require('../utils/logger');
const { loadContentMatrix, getRunIndex, buildDailyBatch, computeBestPublishTime } = require('../config/content-matrix');

// Vendored Agnes Video Generator (free AI text-to-video renderer, MIT).
// One free key from https://platform.agnes-ai.com enables it as a real-render
// engine alongside/behind the FFmpeg chain — see utils/agnes-video-client.js.
const AGNES_SERVICE_DIR = path.join(__dirname, '..', 'vendor', 'agnes-video-generator');
const AGNES_ENV = {
  AGNES_API_KEY: process.env.AGNES_API_KEY || '',
  AGNES_HOST: process.env.AGNES_HOST || '127.0.0.1',
  AGNES_PORT: process.env.AGNES_PORT || '8765'
};

class DailyAutomation {
  constructor(agents, database) {
    this.agents = agents;
    this.db = database;
    this.logger = new Logger('DailyAutomation');
    this.scheduledTasks = new Map();
    this.isEnabled = true;
    this.healthCheckInterval = null;
    this.lastHealthCheck = null;
    // Lazy-created in reportBatchVerdict so tests can stub it out.
    this.telegram = null;
  }

  async initialize() {
    this.logger.info('Initializing daily automation scheduler...');
    
    await this.setupScheduledTasks();
    
    // Start monitoring loop
    this.startMonitoringLoop();
    
    this.logger.success('Daily automation initialized successfully');
    return true;
  }

  async setupScheduledTasks() {
    // Daily content generation at 6:00 AM and 6:00 PM IST (Prime posting times)
    this.scheduledTasks.set('daily-content-generation', 
      cron.schedule('0 6,18 * * *', async () => {
        if (this.isEnabled) {
          await this.runDailyContentGeneration();
        }
      }, { scheduled: false, timezone: 'Asia/Kolkata' })
    );

    // Publishing queue processing every 15 minutes
    this.scheduledTasks.set('publish-queue-processing',
      cron.schedule('*/15 * * * *', async () => {
        if (this.isEnabled) {
          await this.processPublishQueue();
        }
      }, { scheduled: false })
    );

    // AI Comment Reply Agent every 30 minutes
    this.scheduledTasks.set('ai-comment-auto-reply',
      cron.schedule('*/30 * * * *', async () => {
        if (this.isEnabled && this.agents.analytics) {
          await this.agents.analytics.autoReplyToComments().catch(err => {
            this.logger.error('Error in scheduled comment reply:', err.message);
          });
        }
      }, { scheduled: false })
    );

    // Analytics collection at 9:00 AM daily
    this.scheduledTasks.set('daily-analytics',
      cron.schedule('0 9 * * *', async () => {
        if (this.isEnabled) {
          await this.collectDailyAnalytics();
        }
      }, { scheduled: false })
    );

    // Weekly strategy review on Sundays at 8:00 AM
    this.scheduledTasks.set('weekly-strategy-review',
      cron.schedule('0 8 * * 0', async () => {
        if (this.isEnabled) {
          await this.weeklyStrategyReview();
        }
      }, { scheduled: false })
    );

    // Optimization tasks daily at 10:00 PM
    this.scheduledTasks.set('daily-optimization',
      cron.schedule('0 22 * * *', async () => {
        if (this.isEnabled) {
          await this.runDailyOptimization();
        }
      }, { scheduled: false })
    );

    // Database maintenance weekly on Saturdays at 3:00 AM
    this.scheduledTasks.set('database-maintenance',
      cron.schedule('0 3 * * 6', async () => {
        if (this.isEnabled) {
          await this.databaseMaintenance();
        }
      }, { scheduled: false })
    );

    // Start all scheduled tasks
    this.scheduledTasks.forEach((task, name) => {
      task.start();
      this.logger.info(`Started scheduled task: ${name}`);
    });
  }

  async runDailyContentGeneration() {
    if (this.isGeneratingBatch) {
      this.logger.warn('Content generation batch is already in progress; skipping duplicate run.');
      return;
    }
    this.isGeneratingBatch = true;

    // Batch verdict: the permanent no-silent-skip record. Every item must end
    // with outcome ok | scheduled | publish_failed | simulated — anything else
    // is escalated loudly (Telegram + non-zero exit) instead of disappearing.
    const batchVerdict = {
      startedAt: new Date().toISOString(),
      total: 0,
      allSimulated: true,
      published: [],
      scheduled: [],
      items: []
    };

    try {
      this.logger.info('Starting daily content generation (1 Long-Form + 3 Shorts)...');
      
      const timer = this.logger.startTimer('Daily Content Generation (Viral Factory)');

      // Viral factory: 1 long-form video + 3 Shorts derived from it, rotating
      // through the 50-topic × 5-category database with per-format US prime-time
      // publish slots (long 7 PM ET, Shorts 9 AM/1 PM/5 PM ET).
      const matrix = loadContentMatrix();
      const dailyBatch = buildDailyBatch(matrix, getRunIndex());

      for (let i = 0; i < dailyBatch.length; i++) {
        const item = dailyBatch[i];
        const isShort = item.kind === 'short';
        const formatLabel = `${isShort ? `YouTube Short (9:16, ${item.angleId})` : 'Long-Form Video (16:9)'} [${item.language.name}]`;
        this.logger.info(`Generating video ${i + 1} of ${dailyBatch.length} [${formatLabel}] (${item.niche})...`);

        // With an AI provider configured, the niche guides topic selection and the AI
        // picks a fresh angle every run. In template mode pass null so the strategy
        // agent rotates through evergreen topics instead of repeating one niche string.
        const aiAvailable = this.agents.strategy.aiTextService?.isAvailable?.() || false;
        const strategy = await this.agents.strategy.generateContentStrategy(aiAvailable ? item.niche : null);
        strategy.contentType = item.topic.type;
        strategy.isShort = isShort;
        // Shorts derived from the long video carry their derivation angle so the
        // script writer can produce a self-contained funnel piece, not a summary.
        if (isShort) {
          strategy.shortAngle = item.angleId;
          strategy.shortAngleInstruction = item.angleInstruction;
          strategy.derivedFrom = item.derivedFrom;
        }
        // Language threading: script writing, TTS voice and YouTube metadata
        // all read this so the same topic can be produced in any language.
        strategy.language = item.language.code;
        strategy.languageName = item.language.name;
        // Category context (Future & AI, Space, Dark Psychology, …) steers the
        // AI's tone, examples and SEO vocabulary.
        strategy.categoryId = item.topic.categoryId;
        strategy.categoryName = item.topic.categoryName;
        this.logger.info(`[Video ${i + 1}] Strategy topic: ${strategy.topic} [${item.language.name}]`);

        // Generate script
        const script = await this.agents.scriptWriter.generateScript(strategy);

        // Generate thumbnail
        const thumbnail = await this.agents.thumbnailDesigner.generateThumbnail(script);

        // Optimize SEO (Strict YouTube Guidelines + Copyright Safe)
        const seoData = await this.agents.seoOptimizer.optimize(script, strategy);

        // US prime-time publish slot from the matrix: the production agent's
        // calculatePublishTime() honors strategy.bestPublishTime.
        strategy.bestPublishTime = computeBestPublishTime(
          item.publishSlot.hour,
          item.publishSlot.timezone
        );

        // Process through production
        const productionData = await this.agents.production.processContent({
          strategy,
          script,
          thumbnail,
          seo: seoData,
          isShort
        });
        productionData.isShort = isShort;
        productionData.language = item.language.code;
        productionData.languageName = item.language.name;
        productionData.publishSlot = item.publishSlot;

        // ────────────────────────────────────────────────────────────
        // PERMANENT NO-SILENT-SKIP POLICY
        // A batch only counts as success when a real (non-simulated) mp4 was
        // rendered AND uploaded/scheduled. A simulated/missing video must
        // never be invisible: it is escalated to Telegram and remembered in
        // the batch verdict so the cron script exits non-zero and GitHub
        // Actions marks the run red with an alert (root cause of the
        // September "workflow green but nothing published" gap).
        // ────────────────────────────────────────────────────────────
        batchVerdict.total++;
        const finalVideoAsset = productionData.assets?.finalVideo;
        const simulatedVideo = !finalVideoAsset
          || finalVideoAsset.simulated
          || path.extname(String(finalVideoAsset.path || '')).toLowerCase() !== '.mp4';

        if (simulatedVideo) {
          const reason = finalVideoAsset
            ? 'render produced a placeholder instead of an mp4 (missing AGNES_API_KEY / AI keys / FFmpeg?)'
            : 'render produced no video asset at all';
          this.logger.error(`[Video ${i + 1} - ${formatLabel}] ✗ NO REAL VIDEO — ${reason}. NOT uploading a placeholder to YouTube; this run counts as FAILED, not success.`);
          batchVerdict.items.push({
            index: i + 1,
            format: formatLabel,
            topic: strategy.topic,
            language: item.language.code,
            outcome: 'simulated',
            reason
          });
          await this.logAutomationEvent('daily_content_generation', 'error', {
            contentId: productionData.id,
            topic: strategy.topic,
            isShort,
            language: item.language.code,
            error: `no real video: ${reason}`
          });
          continue;
        }
        batchVerdict.allSimulated = false;

        // Schedule for publishing
        const scheduleEntry = await this.agents.publishing.scheduleContent(productionData);
        if (scheduleEntry) {
          scheduleEntry.isShort = isShort;
          scheduleEntry.language = item.language.code;
          this.logger.info(`[Video ${i + 1} - ${formatLabel}] Scheduled and queued for publication`);
          batchVerdict.scheduled.push({ index: i + 1, format: formatLabel, topic: strategy.topic });
          batchVerdict.items.push({ index: i + 1, format: formatLabel, topic: strategy.topic, language: item.language.code, outcome: 'scheduled' });
        } else {
          // A real video that can't be scheduled is still a loud failure.
          batchVerdict.items.push({ index: i + 1, format: formatLabel, topic: strategy.topic, language: item.language.code, outcome: 'publish_failed', reason: 'scheduleContent returned null' });
        }

        // Direct Immediate Publish & Upload to YouTube (Permanent Fix for Ephemeral Cloud/Serverless)
        try {
          this.logger.info(`[Video ${i + 1} - ${formatLabel}] 🚀 Publishing directly & uploading to YouTube...`);
          const published = await this.agents.publishing.publishContent(productionData.id);
          if (published && published.youtubeUrl) {
            this.logger.success(`[Video ${i + 1} - ${formatLabel}] ✅ Successfully published to YouTube: ${published.youtubeUrl}`);
            batchVerdict.published.push({
              index: i + 1,
              format: formatLabel,
              title: published.title,
              url: published.youtubeUrl
            });
          }
        } catch (pubErr) {
          this.logger.error(`[Video ${i + 1} - ${formatLabel}] Direct YouTube upload error:`, pubErr.message);
          batchVerdict.items.push({ index: i + 1, format: formatLabel, topic: strategy.topic, language: item.language.code, outcome: 'publish_failed', reason: pubErr.message });
          // Don't lose the video: it stays in the queue for the 15-min processor and
          // retry passes, so a transient upload error can't silently drop a video.
          await this.processPublishQueue().catch(() => {});
          await this.retryFailedPublishes().catch(() => {});
        }

        // Log individual event
        await this.logAutomationEvent('daily_content_generation', 'success', {
          contentId: productionData.id,
          topic: strategy.topic,
          isShort: item.topic.isShort,
          language: item.language.code,
          scheduledFor: productionData.scheduledPublishTime
        });

        if (!batchVerdict.items.some(it => it.index === i + 1 && it.format === formatLabel)) {
          batchVerdict.items.push({ index: i + 1, format: formatLabel, topic: strategy.topic, language: item.language.code, outcome: 'ok' });
        }

        await new Promise(res => setTimeout(res, 2000));
      }

      timer.end();
      await this.reportBatchVerdict(batchVerdict);

      // Record the generation date so missed-day catch-up and frequency limits work
      await this.db.setSetting('last_content_generation', new Date().toISOString()).catch(() => {});

    } catch (error) {
      this.logger.error('Daily content generation failed:', error);
      
      await this.logAutomationEvent('daily_content_generation', 'error', {
        error: error.message
      });

      // Send notification about failure
      await this.sendFailureNotification('Daily Content Generation', error);

      // Never end silently: the verdict (partial progress included) is
      // escalated before the error propagates to the cron script, which turns
      // it into a non-zero exit for GitHub Actions.
      await this.reportBatchVerdict(batchVerdict).catch(() => {});
      throw error;
    } finally {
      this.isGeneratingBatch = false;
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Permanent no-silent-skip machinery
  // ────────────────────────────────────────────────────────────────────

  /**
   * Bring the vendored Agnes Video Generator service up when a key is set.
   * Returns true when the service is (or becomes) reachable at AGNES_PORT.
   * Best-effort: any error just logs — the FFmpeg chain remains the fallback.
   */
  async ensureAgnesService() {
    if (!AGNES_ENV.AGNES_API_KEY) {
      return false;
    }

    const port = AGNES_ENV.AGNES_PORT;
    const host = AGNES_ENV.AGNES_HOST;
    const healthUrl = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/api/health`;

    const isUp = async () => {
      try {
        const axios = require('axios');
        const res = await axios.get(healthUrl, { timeout: 3000 });
        return res.status >= 200 && res.status < 500;
      } catch (_) {
        return false;
      }
    };

    if (await isUp()) {
      this.logger.info(`Agnes video service already running at ${healthUrl}`);
      return true;
    }

    // venv python inside the vendored repo (created by bin/cli.js / setup below)
    const venvPython = process.platform === 'win32'
      ? path.join(AGNES_SERVICE_DIR, '.venv', 'Scripts', 'python.exe')
      : path.join(AGNES_SERVICE_DIR, '.venv', 'bin', 'python');
    const hasVenv = await fs.access(venvPython).then(() => true).catch(() => false);
    if (!hasVenv) {
      this.logger.warn(`Agnes service not installed (no venv at ${venvPython}). Run: node vendor/agnes-video-generator/bin/cli.js --port ${port} --no-open`);
      return false;
    }

    this.logger.info(`Starting Agnes video service at ${healthUrl}...`);
    const child = spawn(venvPython, ['server.py'], {
      cwd: AGNES_SERVICE_DIR,
      env: {
        ...process.env,
        ...AGNES_ENV,
        HOST: host,
        PORT: port
      },
      stdio: 'ignore',
      detached: process.platform !== 'win32'
    });
    child.on('error', err => this.logger.warn(`Agnes service spawn failed: ${err.message}`));
    if (process.platform !== 'win32') {
      child.unref();
    }

    // Wait up to 90s for the FastAPI server to answer
    for (let i = 0; i < 45; i++) {
      if (await isUp()) {
        this.logger.info('Agnes video service is ready');
        return true;
      }
      await new Promise(res => setTimeout(res, 2000));
    }
    this.logger.warn('Agnes video service did not become ready in 90s — continuing without it');
    return false;
  }

  /**
   * Print the batch verdict and escalate any failure to Telegram.
   * A batch is a full success only when at least one real video reached
   * YouTube (published) or was scheduled with a real mp4 behind it.
   */
  async reportBatchVerdict(batchVerdict) {
    const publishedCount = batchVerdict.published.length;
    const scheduledCount = batchVerdict.scheduled.length;
    const simulatedItems = batchVerdict.items.filter(it => it.outcome === 'simulated');
    const failedItems = batchVerdict.items.filter(it => it.outcome === 'publish_failed');

    const lines = batchVerdict.items.map(it => {
      const mark = it.outcome === 'simulated' ? '✗' : (it.outcome === 'publish_failed' ? '⚠️' : '✓');
      const extra = it.reason ? ` — ${it.reason}` : '';
      return `  ${mark} #${it.index} [${it.format}] ${it.topic || ''}${extra}`;
    });

    const summary = [
      `Batch verdict: total=${batchVerdict.total} published=${publishedCount} scheduled=${scheduledCount} simulated=${simulatedItems.length} publishFailed=${failedItems.length}`,
      ...lines
    ].join('\n');
    this.logger.info(summary);

    const batchFailed = publishedCount === 0 && scheduledCount === 0;
    if (batchFailed) {
      if (!this.telegram) {
        const { TelegramNotifier } = require('../utils/telegram-notifier');
        this.telegram = new TelegramNotifier();
      }
      const problem = simulatedItems.length > 0
        ? `NO REAL VIDEO WAS RENDERED (${simulatedItems.length} placeholder result${simulatedItems.length === 1 ? '' : 's'}).\nLikely cause: missing AGNES_API_KEY / AI provider keys / FFmpeg in the run environment.`
        : 'The batch finished without a single publishable video (no publish and no schedule entry).';
      const msg = `🚨 <b>DAILY AUTOMATION FAILED — NOTHING WAS PUBLISHED</b>\n\n${problem}\n\n${summary}\n\nCheck the GitHub Actions log of the latest run.`;
      await this.telegram.sendMessage(msg).catch(err => {
        this.logger.error('Telegram escalation failed:', err.message);
      });
    }

    return !batchFailed;
  }

  async shouldGenerateContentToday() {
    // Check content buffer
    const upcomingContent = await this.agents.publishing.getUpcomingSchedule(3);
    const bufferDays = parseInt(await this.db.getSetting('content_buffer_days')) || 3;
    
    // Check if we have enough content scheduled
    if (upcomingContent.length >= bufferDays) {
      return false;
    }

    // Check posting frequency settings
    const frequency = await this.db.getSetting('posting_frequency') || 'daily';
    const lastGeneration = await this.db.getSetting('last_content_generation');
    
    if (lastGeneration) {
      const lastDate = new Date(lastGeneration);
      const today = new Date();
      const daysSinceLastGeneration = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));
      
      switch (frequency) {
        case 'daily':
          return daysSinceLastGeneration >= 1;
        case 'every-2-days':
          return daysSinceLastGeneration >= 2;
        case '3-per-week':
          return daysSinceLastGeneration >= 2 || [1, 3, 5].includes(today.getDay());
        case 'weekly':
          return daysSinceLastGeneration >= 7;
        default:
          return true;
      }
    }

    return true;
  }

  async processPublishQueue(forceAll = false) {
    try {
      const published = await this.agents.publishing.processPublishQueue(forceAll);
      
      if (published > 0) {
        this.logger.info(`Published ${published} videos from queue`);
        
        await this.logAutomationEvent('queue_processing', 'success', {
          publishedCount: published
        });
      }
    } catch (error) {
      this.logger.error('Failed to process publish queue:', error);
      
      await this.logAutomationEvent('queue_processing', 'error', {
        error: error.message
      });
    }
  }

  // Retry entries that previously failed (quota, transient network/API errors).
  // Without this, one failed upload made the entry invisible to the 15-min queue
  // processor forever and the video never reached the channel.
  async retryFailedPublishes() {
    try {
      const failed = await this.db.getAllRows(
        "SELECT * FROM publish_schedule WHERE status = 'failed' AND error_message NOT LIKE '%exceeded the number of videos%' ORDER BY publish_time ASC LIMIT 3"
      );

      for (const row of failed) {
        const attempts = (row.retry_count || 0);
        if (attempts >= 5) {
          continue;
        }
        try {
          this.logger.info(`Retrying previously failed publish: ${row.title}`);
          await this.agents.publishing.publishContent(row.production_id);
        } catch (error) {
          await this.db.executeQuery(
            'UPDATE publish_schedule SET retry_count = retry_count + 1, error_message = ? WHERE id = ?',
            [error.message, row.id]
          ).catch(() => {});
          this.logger.warn(`Retry failed for ${row.title}: ${error.message}`);
        }
        await this.sleep(3000);
      }
    } catch (error) {
      this.logger.error('Failed publish retry pass error:', error.message);
    }
  }

  // Startup catch-up: if the machine/server was off during a scheduled generation
  // window, run the batch now so the channel never silently skips a day.
  async catchUpMissedGeneration() {
    try {
      const lastGeneration = await this.db.getSetting('last_content_generation');
      const today = new Date().toDateString();
      const generatedToday = lastGeneration && new Date(lastGeneration).toDateString() === today;

      if (generatedToday) {
        return false;
      }

      const upcoming = await this.agents.publishing.getUpcomingSchedule(2).catch(() => []);
      const bufferDays = parseInt(await this.db.getSetting('content_buffer_days')) || 3;
      if (upcoming.length >= bufferDays) {
        this.logger.info(`Startup catch-up skipped: ${upcoming.length} videos already scheduled ahead.`);
        return false;
      }

      this.logger.warn('Missed scheduled generation detected — running catch-up batch now.');
      await this.runDailyContentGeneration();
      return true;
    } catch (error) {
      this.logger.error('Startup catch-up failed:', error.message);
      return false;
    }
  }

  async collectDailyAnalytics() {
    try {
      this.logger.info('Starting daily analytics collection...');
      
      // Get recently published videos
      const recentVideos = await this.getRecentlyPublishedVideos(7);
      
      let processedCount = 0;
      
      for (const video of recentVideos) {
        try {
          await this.agents.analytics.analyzeVideoPerformance(video.youtube_id);
          processedCount++;
          
          this.logger.info(`Analyzed video: ${video.title}`);
          
          // Small delay to avoid API rate limits
          await this.sleep(2000);
        } catch (error) {
          this.logger.error(`Failed to analyze video ${video.youtube_id}:`, error);
        }
      }

      this.logger.success(`Analytics collection completed. Processed ${processedCount} videos`);
      
      await this.logAutomationEvent('analytics_collection', 'success', {
        videosProcessed: processedCount
      });

    } catch (error) {
      this.logger.error('Daily analytics collection failed:', error);
      
      await this.logAutomationEvent('analytics_collection', 'error', {
        error: error.message
      });
    }
  }

  async weeklyStrategyReview() {
    try {
      this.logger.info('Starting weekly strategy review...');
      
      // Analyze performance of last week's content
      const weeklyAnalytics = await this.agents.analytics.getRecentAnalytics(7);
      
      // Update content strategy based on performance
      if (weeklyAnalytics.topPerformers.length > 0) {
        const bestPerformingTopics = weeklyAnalytics.topPerformers
          .map(video => video.videoDetails.title)
          .slice(0, 3);
        
        this.logger.info(`Top performing topics: ${bestPerformingTopics.join(', ')}`);
      }

      // Optimize publishing times
      await this.agents.publishing.optimizePublishTimes();
      
      // Generate strategy insights
      const insights = await this.generateWeeklyInsights(weeklyAnalytics);
      
      this.logger.success('Weekly strategy review completed');
      
      await this.logAutomationEvent('weekly_strategy_review', 'success', {
        insights
      });

    } catch (error) {
      this.logger.error('Weekly strategy review failed:', error);
      
      await this.logAutomationEvent('weekly_strategy_review', 'error', {
        error: error.message
      });
    }
  }

  async runDailyOptimization() {
    try {
      this.logger.info('Starting daily optimization tasks...');
      
      // Optimize existing content SEO
      await this.optimizeExistingContent();
      
      // Update keyword performance data
      await this.updateKeywordPerformance();
      
      // Clean up old files
      await this.cleanupOldFiles();
      
      this.logger.success('Daily optimization completed');
      
      await this.logAutomationEvent('daily_optimization', 'success');

    } catch (error) {
      this.logger.error('Daily optimization failed:', error);
      
      await this.logAutomationEvent('daily_optimization', 'error', {
        error: error.message
      });
    }
  }

  async databaseMaintenance() {
    try {
      this.logger.info('Starting database maintenance...');
      
      // Create backup
      const backupPath = await this.db.backup();
      this.logger.info(`Database backed up to: ${backupPath}`);
      
      // Get database stats
      const stats = await this.db.getStats();
      this.logger.info(`Database stats: ${JSON.stringify(stats)}`);
      
      // Clean old analytics data (older than 90 days)
      await this.cleanOldAnalytics();
      
      this.logger.success('Database maintenance completed');
      
      await this.logAutomationEvent('database_maintenance', 'success', {
        backupPath,
        stats
      });

    } catch (error) {
      this.logger.error('Database maintenance failed:', error);
      
      await this.logAutomationEvent('database_maintenance', 'error', {
        error: error.message
      });
    }
  }

  // Helper methods
  async getRecentlyPublishedVideos(days) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const rows = await this.db.getAllRows(
      `SELECT * FROM publish_schedule 
       WHERE status = 'published' AND published_at > ?
       ORDER BY published_at DESC`,
      [cutoffDate.toISOString()]
    );
    
    return rows;
  }

  async generateWeeklyInsights(analytics) {
    const insights = [];
    
    if (analytics.averagePerformanceScore > 80) {
      insights.push('Content performance is excellent this week');
    } else if (analytics.averagePerformanceScore < 50) {
      insights.push('Content performance needs improvement');
    }
    
    if (analytics.topPerformers.length > 0) {
      insights.push(`Best performing video: ${analytics.topPerformers[0].videoDetails.title}`);
    }
    
    return insights;
  }

  async optimizeExistingContent() {
    // Get videos published in last 30 days with low performance
    const lowPerformingVideos = await this.db.getAllRows(
      `SELECT ar.* FROM analytics_reports ar
       JOIN publish_schedule ps ON ar.video_id = ps.id
       WHERE ar.performance_score < 50 
       AND ps.published_at > datetime('now', '-30 days')
       LIMIT 5`
    );
    
    for (const video of lowPerformingVideos) {
      // Re-analyze and generate optimization suggestions
      await this.agents.analytics.analyzeVideoPerformance(video.video_id);
      this.logger.info(`Re-analyzed low performing video: ${video.video_id}`);
    }
  }

  async updateKeywordPerformance() {
    // Update keyword performance based on recent analytics
    const recentVideos = await this.getRecentlyPublishedVideos(7);
    
    for (const video of recentVideos) {
      const analyticsData = await this.db.getRow(
        'SELECT * FROM analytics_reports WHERE video_id = ?',
        [video.id]
      );
      
      if (analyticsData) {
        const videoDetails = JSON.parse(analyticsData.video_details);
        const keywords = videoDetails.tags || [];
        
        for (const keyword of keywords) {
          await this.db.updateKeywordPerformance(
            keyword,
            videoDetails.statistics.viewCount,
            video.youtube_id
          );
        }
      }
    }
  }

  async cleanupOldFiles() {
    // Clean up temporary files older than 7 days
    const fs = require('fs').promises;
    const path = require('path');
    
    const tempDir = path.join(__dirname, '..', 'temp');
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    
    try {
      await this.cleanDirectoryOldFiles(tempDir, 7);
      await this.cleanDirectoryOldFiles(uploadsDir, 30);
      this.logger.info('Old files cleaned up');
    } catch (error) {
      this.logger.error('Failed to clean up old files:', error);
    }
  }

  async cleanDirectoryOldFiles(directory, days) {
    const fs = require('fs').promises;
    const path = require('path');
    
    try {
      const files = await fs.readdir(directory);
      const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
      
      for (const file of files) {
        const filePath = path.join(directory, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          await fs.unlink(filePath);
        }
      }
    } catch (error) {
      // Directory might not exist, which is fine
    }
  }

  async cleanOldAnalytics() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);
    
    await this.db.executeQuery(
      'DELETE FROM analytics_reports WHERE analyzed_at < ?',
      [cutoffDate.toISOString()]
    );
  }

  async logAutomationEvent(eventType, status, data = {}) {
    await this.db.executeQuery(
      'INSERT INTO automation_events (event_type, status, data, created_at) VALUES (?, ?, ?, datetime("now"))',
      [eventType, status, JSON.stringify(data)]
    );
  }

  async sendFailureNotification(taskName, error) {
    // This would integrate with notification services (email, Slack, etc.)
    this.logger.error(`AUTOMATION FAILURE - ${taskName}: ${error.message}`);
    
    // Could send webhook notification, email, etc.
    // For now, just log it prominently
  }

  startMonitoringLoop() {
    // Monitor system health every hour
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        this.logger.error('Health check failed:', error);
      }
    }, 60 * 60 * 1000); // 1 hour
  }

  async performHealthCheck() {
    this.lastHealthCheck = new Date();

    const health = {
      timestamp: new Date().toISOString(),
      database: false,
      agents: {},
      scheduledTasks: {},
      systemResources: {}
    };

    // Check database
    try {
      await this.db.getAllRows('SELECT 1');
      health.database = true;
    } catch (error) {
      health.database = false;
    }

    // Check scheduled tasks
    this.scheduledTasks.forEach((task, name) => {
      health.scheduledTasks[name] = task.running;
    });

    // Get system resources (simplified)
    health.systemResources = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version
    };

    // Log health status
    const healthScore = this.calculateHealthScore(health);
    
    if (healthScore < 80) {
      this.logger.warn(`System health score: ${healthScore}/100`, health);
    } else {
      this.logger.info(`System health check passed: ${healthScore}/100`);
    }
    
    return health;
  }

  calculateHealthScore(health) {
    let score = 100;
    
    if (!health.database) score -= 30;
    
    const tasksRunning = Object.values(health.scheduledTasks).filter(Boolean).length;
    const totalTasks = Object.keys(health.scheduledTasks).length;
    
    if (totalTasks > 0 && tasksRunning < totalTasks) {
      score -= ((totalTasks - tasksRunning) / totalTasks) * 20;
    }
    
    return Math.max(0, Math.round(score));
  }

  // Control methods
  async pauseAutomation() {
    this.isEnabled = false;
    this.logger.info('Automation paused');
  }

  async resumeAutomation() {
    this.isEnabled = true;
    this.logger.info('Automation resumed');
  }

  async stopAutomation() {
    this.scheduledTasks.forEach((task, name) => {
      task.stop();
      this.logger.info(`Stopped scheduled task: ${name}`);
    });
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this.isEnabled = false;
    this.logger.info('All automation tasks stopped');
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getAutomationStatus() {
    return {
      enabled: this.isEnabled,
      scheduledTasks: Array.from(this.scheduledTasks.keys()).map(name => ({
        name,
        running: this.scheduledTasks.get(name).running
      })),
      lastHealthCheck: this.lastHealthCheck,
      uptime: process.uptime()
    };
  }
}

module.exports = { DailyAutomation };