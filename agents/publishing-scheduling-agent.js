const { google } = require('googleapis');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { Logger } = require('../utils/logger');
const { TelegramNotifier } = require('../utils/telegram-notifier');

class PublishingSchedulingAgent {
  constructor(db, credentials) {
    this.db = db;
    this.credentials = credentials;
    this.logger = new Logger('PublishingScheduling');
    this.youtube = null;
    this.publishQueue = [];
    this.telegram = new TelegramNotifier();
  }

  async initialize() {
    this.logger.info('Initializing Publishing & Scheduling Agent...');
    await this.setupYouTubeAPI();
    await this.loadPublishQueue();
    // Auto-detect Telegram channel ID if not set
    await this.telegram.detectChannelId();
    if (this.telegram.enabled) {
      this.logger.info('Telegram notifications enabled');
    } else {
      this.logger.warn('Telegram notifications disabled — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID');
    }
    return true;
  }

  // Returns the best UTC publish time based on YouTube peak hours (IST)
  getBestPublishTime() {
    // Best times to post on YouTube (IST): 6–9 PM on weekdays, 10 AM–12 PM weekends
    const now = new Date();
    // Convert to IST (UTC+5:30)
    const istOffset = 5.5 * 60 * 60 * 1000;
    const ist = new Date(now.getTime() + istOffset);
    const dayOfWeek = ist.getUTCDay(); // 0=Sun, 6=Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Target publish hour in IST
    const targetHourIST = isWeekend ? 11 : 19; // 11 AM weekend, 7 PM weekday

    // Build target date in IST
    const target = new Date(ist);
    target.setUTCHours(targetHourIST, 0, 0, 0);

    // If target time already passed today, schedule for tomorrow
    if (target.getTime() <= ist.getTime()) {
      target.setUTCDate(target.getUTCDate() + 1);
    }

    // Convert back to UTC
    const utcTarget = new Date(target.getTime() - istOffset);
    this.logger.info(`Best publish time: ${utcTarget.toISOString()} (${isWeekend ? '11 AM' : '7 PM'} IST)`);
    return utcTarget.toISOString();
  }

  async setupYouTubeAPI() {
    try {
      const auth = this.credentials.getYouTubeAuth();
      this.youtube = google.youtube({ version: 'v3', auth });
      this.logger.info('YouTube API initialized');
    } catch (error) {
      // YouTube tokens not yet available (e.g. first deploy before OAuth).
      // The server still starts so the user can complete the OAuth flow
      // via the dashboard and then restart/redeploy.
      this.logger.warn('YouTube API not initialised (no tokens yet) — complete OAuth via the dashboard to enable uploads');
    }
  }

  async loadPublishQueue() {
    try {
      const queue = await this.db.getPublishQueue();
      this.publishQueue = queue || [];
      this.logger.info(`Loaded ${this.publishQueue.length} items in publish queue`);
    } catch (error) {
      this.logger.warn('No existing publish queue found');
    }
  }

  async scheduleContent(productionData) {
    try {
      const finalVideo = productionData.assets?.finalVideo;
      if (!finalVideo || finalVideo.simulated) {
        this.logger.warn(`Not scheduling ${productionData.id}: video asset missing or simulated.`);
        return null;
      }

      this.logger.info(`Scheduling content: ${productionData.id}`);

      const scheduleEntry = {
        productionId: productionData.id,
        title: productionData.script.title,
        publishTime: productionData.scheduledPublishTime,
        status: 'scheduled',
        priority: productionData.priority,
        metadata: {
          seo: productionData.seo,
          thumbnail: productionData.assets.thumbnail,
          video: productionData.assets.finalVideo,
          captions: productionData.assets.captions
        },
        createdAt: new Date().toISOString()
      };
      
      this.publishQueue.push(scheduleEntry);
      this.publishQueue.sort((a, b) => new Date(a.publishTime) - new Date(b.publishTime));
      
      await this.db.saveScheduleEntry(scheduleEntry);
      
      this.logger.info(`Content scheduled for: ${scheduleEntry.publishTime}`);

      // Send Telegram notification for scheduled video
      await this.telegram.notifyVideoScheduled({
        title: scheduleEntry.title,
        scheduledTime: scheduleEntry.publishTime,
        topic: scheduleEntry.metadata?.seo?.primaryKeyword || productionData.script?.title || ''
      });

      return scheduleEntry;
    } catch (error) {
      this.logger.error('Failed to schedule content:', error);
      throw error;
    }
  }

  async publishContent(contentId) {
    try {
      this.logger.info(`Publishing content: ${contentId}`);
      
      let scheduleEntry = this.publishQueue.find(entry => 
        entry.productionId === contentId || entry.id === contentId
      );
      
      if (!scheduleEntry) {
        this.logger.info(`Fetching schedule entry ${contentId} from database...`);
        const allSchedule = await this.db.getUpcomingSchedule().catch(() => []);
        scheduleEntry = allSchedule.find(entry => entry.productionId === contentId || entry.id === contentId || entry.production_id === contentId);
      }

      if (!scheduleEntry) {
        throw new Error(`Content not found in queue or DB: ${contentId}`);
      }
      
      // Upload video to YouTube
      const uploadResult = await this.uploadToYouTube(scheduleEntry);
      
      // Update database
      scheduleEntry.status = 'published';
      scheduleEntry.publishedAt = new Date().toISOString();
      scheduleEntry.youtubeId = uploadResult.id;
      scheduleEntry.youtubeUrl = `https://www.youtube.com/watch?v=${uploadResult.id}`;
      
      await this.db.updateScheduleEntry(scheduleEntry);
      
      // Remove from queue
      this.publishQueue = this.publishQueue.filter(entry => entry.productionId !== scheduleEntry.productionId);
      
      this.logger.success(`Content published: ${scheduleEntry.youtubeUrl}`);

      // Append to notifications.log
      await fs.appendFile(
        path.join(__dirname, '..', 'notifications.log'),
        `[${new Date().toISOString()}] Video published: ${scheduleEntry.title} – ${scheduleEntry.youtubeUrl}\n`
      ).catch(() => {});

      // Send Telegram notification
      await this.telegram.notifyVideoPublished({
        title: scheduleEntry.title,
        youtubeUrl: scheduleEntry.youtubeUrl,
        scheduledTime: scheduleEntry.publishedAt,
        topic: scheduleEntry.metadata?.seo?.primaryKeyword || ''
      });

      return scheduleEntry;
    } catch (error) {
      this.logger.error('Failed to publish content:', error);
      throw error;
    }
  }

  async uploadToYouTube(scheduleEntry) {
    if (!this.youtube) {
      await this.setupYouTubeAPI();
    }
    if (!this.youtube) {
      throw new Error('YouTube API not authenticated. Please complete YouTube OAuth consent flow on the dashboard.');
    }

    const { metadata } = scheduleEntry;
    const isShort = scheduleEntry.isShort || metadata.video?.isShort || false;
    
    const rawTitle = metadata.seo.title || scheduleEntry.title || 'Viral Video';
    const videoTitle = isShort 
      ? (rawTitle.toLowerCase().includes('#shorts') ? rawTitle : `${rawTitle} #Shorts`)
      : rawTitle.replace(/#shorts/gi, '').trim();

    // YouTube Community & Monetization Guidelines Compliance Notice
    const complianceDisclaimer = "\n\n--- \nDisclaimer: This video is created for entertainment and educational purposes in full compliance with YouTube Community Guidelines & Terms of Service.";
    const videoDescription = `${metadata.seo.description}${isShort ? '\n\n#Shorts #Viral #Trending' : ''}${complianceDisclaimer}`;

    const rawTags = isShort ? [...(metadata.seo.tags || []), 'Shorts', 'Short'] : (metadata.seo.tags || []);
    const cleanTags = Array.from(new Set(rawTags.map(t => String(t).replace(/[^a-zA-Z0-9]/g, '').trim()).filter(t => t.length > 0 && t.length < 30))).slice(0, 15);

    // Prepare video metadata
    const videoMetadata = {
      snippet: {
        title: videoTitle.slice(0, 100),
        description: videoDescription.slice(0, 5000),
        tags: cleanTags,
        categoryId: (metadata.seo.metadata?.category || 24).toString(),
        defaultLanguage: 'en',
        defaultAudioLanguage: 'en'
      },
      status: {
        privacyStatus: process.env.DEFAULT_PRIVACY_STATUS || 'public',
        publishAt: scheduleEntry.publishTime,
        selfDeclaredMadeForKids: false // Strict compliance for general audience monetization
      }
    };
    
    // Upload video file
    const videoUpload = await this.youtube.videos.insert({
      part: 'snippet,status',
      requestBody: videoMetadata,
      media: {
        body: await this.getVideoStream(metadata.video.path)
      }
    });
    
    const videoId = videoUpload.data.id;
    this.logger.info(`Video uploaded with ID: ${videoId}`);
    
    // Upload thumbnail
    if (metadata.thumbnail && metadata.thumbnail.path) {
      await this.uploadThumbnail(videoId, metadata.thumbnail.path);
    }
    
    // Upload captions
    if (metadata.captions && metadata.captions.path) {
      await this.uploadCaptions(videoId, metadata.captions.path);
    }
    
    return videoUpload.data;
  }

  async getVideoStream(videoPath) {
    try {
      // Check if real video mp4 exists
      let targetPath = videoPath;
      if (path.extname(videoPath).toLowerCase() === '.json' || !videoPath.endsWith('.mp4')) {
        targetPath = videoPath.replace(/\.assembly\.json$/i, '').replace(/\.json$/i, '') + '.mp4';
      }

      const exists = await fs.stat(targetPath).then(s => s.isFile() && s.size > 0).catch(() => false);
      
      if (!exists) {
        throw new Error(`video file not found: ${targetPath}`);
      }

      return fsSync.createReadStream(targetPath);
    } catch (error) {
      this.logger.error('Failed to get video stream for upload:', error.message);
      throw error;
    }
  }
  async uploadThumbnail(videoId, thumbnailPath) {
    try {
      const thumbnailBuffer = await fs.readFile(thumbnailPath);
      
      await this.youtube.thumbnails.set({
        videoId: videoId,
        media: {
          body: thumbnailBuffer
        }
      });
      
      this.logger.info(`Thumbnail uploaded for video: ${videoId}`);
    } catch (error) {
      this.logger.error(`Failed to upload thumbnail: ${error.message}`);
    }
  }

  async uploadCaptions(videoId, captionsPath) {
    try {
      const captionsContent = await fs.readFile(captionsPath, 'utf8');
      
      await this.youtube.captions.insert({
        part: 'snippet',
        requestBody: {
          snippet: {
            videoId: videoId,
            language: 'en',
            name: 'English Captions',
            isDraft: false
          }
        },
        media: {
          body: captionsContent
        }
      });
      
      this.logger.info(`Captions uploaded for video: ${videoId}`);
    } catch (error) {
      this.logger.error(`Failed to upload captions: ${error.message}`);
    }
  }

  async processPublishQueue() {
    const now = new Date();
    const scheduled = this.publishQueue
      .filter(entry => entry.status === 'scheduled')
      .sort((a, b) => new Date(a.publishTime) - new Date(b.publishTime));
    const readyToPublish = scheduled.filter(entry => new Date(entry.publishTime) <= now);

    if (readyToPublish.length === 0) {
      if (scheduled.length > 0) {
        this.logger.info(`Publish queue: ${scheduled.length} item(s) waiting, next publish at ${scheduled[0].publishTime}`);
      } else {
        this.logger.info('Publish queue is empty — nothing scheduled yet.');
      }
      return 0;
    }

    this.logger.info(`Processing publish queue: ${readyToPublish.length} item(s) ready to publish...`);

    for (const entry of readyToPublish) {
      try {
        await this.publishContent(entry.productionId);
        this.logger.info(`Auto-published: ${entry.title}`);
      } catch (error) {
        this.logger.error(`Failed to auto-publish ${entry.title}:`, error);
        // Mark as failed but don't stop processing other items
        entry.status = 'failed';
        entry.error = error.message;
        await this.db.updateScheduleEntry(entry);
      }
    }
    
    return readyToPublish.length;
  }

  async getUpcomingSchedule(days = 7) {
    const now = new Date();
    const endDate = new Date(now.getTime() + (days * 24 * 60 * 60 * 1000));
    
    return this.publishQueue
      .filter(entry => {
        const publishTime = new Date(entry.publishTime);
        return publishTime >= now && publishTime <= endDate;
      })
      .sort((a, b) => new Date(a.publishTime) - new Date(b.publishTime));
  }

  async optimizePublishTimes() {
    // Analyze channel analytics to find optimal publish times
    const analytics = await this.getChannelAnalytics();
    const optimalTimes = this.calculateOptimalTimes(analytics);
    
    // Update scheduled content with better times
    for (const entry of this.publishQueue) {
      if (entry.status === 'scheduled') {
        const currentTime = new Date(entry.publishTime);
        const betterTime = this.findBetterTime(currentTime, optimalTimes);
        
        if (betterTime && betterTime.getTime() !== currentTime.getTime()) {
          entry.publishTime = betterTime.toISOString();
          await this.db.updateScheduleEntry(entry);
          this.logger.info(`Optimized publish time for: ${entry.title}`);
        }
      }
    }
  }

  async getChannelAnalytics() {
    try {
      // Get channel analytics for the last 30 days
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - (30 * 24 * 60 * 60 * 1000));
      
      const response = await this.youtube.channels.list({
        part: 'statistics',
        mine: true
      });
      
      // In a full implementation, you'd use YouTube Analytics API
      // For now, we'll return simulated data
      return {
        totalViews: response.data.items[0]?.statistics?.viewCount || 0,
        subscribers: response.data.items[0]?.statistics?.subscriberCount || 0,
        videos: response.data.items[0]?.statistics?.videoCount || 0,
        optimalDays: ['Tuesday', 'Wednesday', 'Thursday'], // Most active days
        optimalHours: [14, 15, 16, 20] // Most active hours
      };
    } catch (error) {
      this.logger.error('Failed to get channel analytics:', error);
      return {
        optimalDays: ['Tuesday', 'Wednesday', 'Thursday'],
        optimalHours: [14, 15, 16]
      };
    }
  }

  calculateOptimalTimes(analytics) {
    const { optimalDays, optimalHours } = analytics;
    
    return {
      bestDays: optimalDays,
      bestHours: optimalHours,
      worstDays: ['Monday', 'Friday'],
      worstHours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 22, 23]
    };
  }

  findBetterTime(currentTime, optimalTimes) {
    const currentDay = currentTime.toLocaleDateString('en-US', { weekday: 'long' });
    const currentHour = currentTime.getHours();
    
    // If current time is already optimal, return null
    if (optimalTimes.bestDays.includes(currentDay) && 
        optimalTimes.bestHours.includes(currentHour)) {
      return null;
    }
    
    // Find the next optimal time
    const nextOptimalTime = new Date(currentTime);
    
    // Try to find an optimal hour on the same day
    for (const hour of optimalTimes.bestHours) {
      if (hour > currentHour) {
        nextOptimalTime.setHours(hour, 0, 0, 0);
        if (optimalTimes.bestDays.includes(currentDay)) {
          return nextOptimalTime;
        }
      }
    }
    
    // Find next optimal day
    for (let i = 1; i <= 7; i++) {
      const testDate = new Date(currentTime.getTime() + (i * 24 * 60 * 60 * 1000));
      const testDay = testDate.toLocaleDateString('en-US', { weekday: 'long' });
      
      if (optimalTimes.bestDays.includes(testDay)) {
        testDate.setHours(optimalTimes.bestHours[0], 0, 0, 0);
        return testDate;
      }
    }
    
    return null; // No better time found
  }

  async createPublishingReport() {
    const report = {
      queueStatus: {
        total: this.publishQueue.length,
        scheduled: this.publishQueue.filter(e => e.status === 'scheduled').length,
        published: this.publishQueue.filter(e => e.status === 'published').length,
        failed: this.publishQueue.filter(e => e.status === 'failed').length
      },
      upcomingPublications: await this.getUpcomingSchedule(7),
      recentPublications: this.publishQueue
        .filter(e => e.status === 'published' && 
                new Date(e.publishedAt) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)),
      performance: await this.getPublishingPerformance(),
      generatedAt: new Date().toISOString()
    };
    
    return report;
  }

  async getPublishingPerformance() {
    const published = this.publishQueue.filter(e => e.status === 'published');
    
    if (published.length === 0) {
      return {
        totalPublished: 0,
        averageScheduleAccuracy: 0,
        publishingFrequency: 0
      };
    }
    
    // Calculate schedule accuracy
    let totalDelay = 0;
    let accuratePublishes = 0;
    
    published.forEach(entry => {
      const scheduledTime = new Date(entry.publishTime);
      const actualTime = new Date(entry.publishedAt);
      const delay = Math.abs(actualTime - scheduledTime) / (1000 * 60); // minutes
      
      totalDelay += delay;
      if (delay <= 5) accuratePublishes++; // Within 5 minutes is considered accurate
    });
    
    const averageDelay = totalDelay / published.length;
    const accuracyRate = (accuratePublishes / published.length) * 100;
    
    return {
      totalPublished: published.length,
      averageScheduleAccuracy: `${accuracyRate.toFixed(1)}%`,
      averageDelay: `${averageDelay.toFixed(1)} minutes`,
      publishingFrequency: this.calculatePublishingFrequency(published)
    };
  }

  calculatePublishingFrequency(published) {
    if (published.length < 2) return 'Insufficient data';
    
    const dates = published.map(p => new Date(p.publishedAt)).sort((a, b) => a - b);
    const totalDays = (dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24);
    const frequency = published.length / totalDays;
    
    if (frequency >= 1) return `${frequency.toFixed(1)} videos per day`;
    if (frequency >= 0.14) return `${(frequency * 7).toFixed(1)} videos per week`;
    return `${(frequency * 30).toFixed(1)} videos per month`;
  }

  async emergencyPublish(contentId, delayMinutes = 0) {
    // For urgent publishing needs
    this.logger.info(`Emergency publish requested: ${contentId}`);
    
    const entry = this.publishQueue.find(e => 
      e.productionId === contentId || e.id === contentId
    );
    
    if (!entry) {
      throw new Error(`Content not found: ${contentId}`);
    }
    
    if (delayMinutes > 0) {
      const newPublishTime = new Date(Date.now() + (delayMinutes * 60 * 1000));
      entry.publishTime = newPublishTime.toISOString();
      await this.db.updateScheduleEntry(entry);
      this.logger.info(`Emergency scheduled for: ${entry.publishTime}`);
      return entry;
    } else {
      return await this.publishContent(contentId);
    }
  }

  async pauseScheduledContent(contentId) {
    const entry = this.publishQueue.find(e => 
      e.productionId === contentId || e.id === contentId
    );
    
    if (!entry) {
      throw new Error(`Content not found: ${contentId}`);
    }
    
    entry.status = 'paused';
    await this.db.updateScheduleEntry(entry);
    
    this.logger.info(`Content paused: ${entry.title}`);
    return entry;
  }

  async resumeScheduledContent(contentId, newPublishTime = null) {
    const entry = this.publishQueue.find(e => 
      e.productionId === contentId || e.id === contentId
    );
    
    if (!entry) {
      throw new Error(`Content not found: ${contentId}`);
    }
    
    entry.status = 'scheduled';
    if (newPublishTime) {
      entry.publishTime = new Date(newPublishTime).toISOString();
    }
    
    await this.db.updateScheduleEntry(entry);
    
    this.logger.info(`Content resumed: ${entry.title}`);
    return entry;
  }
}

module.exports = { PublishingSchedulingAgent };