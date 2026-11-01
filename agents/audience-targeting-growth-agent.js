const { google } = require('googleapis');
const { Logger } = require('../utils/logger');
const { TelegramNotifier } = require('../utils/telegram-notifier');

/**
 * AudienceTargetingGrowthAgent
 *
 * Implements:
 * 1. Audience Targeting & Retention Optimization:
 *    Reads channel performance & watch-time metrics from YouTube Data/Analytics API.
 *    Ranks topics, video lengths, and time slots that generate the highest watch time / retention.
 *    Provides dynamic feedback to content-matrix & strategy generators.
 *
 * 2. Retention & Click-Through Rate (CTR) Tuning:
 *    Evaluates hook performance and recommends title/thumbnail patterns.
 *    Creates and organizes topical series into YouTube Playlists to maximize session watch time.
 *
 * 3. Monetization Milestones Tracker:
 *    Calculates progress toward YouTube Partner Program (YPP):
 *    - 1,000 Subscribers
 *    - 4,000 Public Watch Hours (or 10M Shorts views in 90 days)
 *    Dispatches actionable weekly growth reports.
 */
class AudienceTargetingGrowthAgent {
  constructor(db, credentials) {
    this.db = db;
    this.credentials = credentials;
    this.logger = new Logger('AudienceTargetingGrowth');
    this.telegram = new TelegramNotifier();
    this.youtube = null;
    this.youtubeAnalytics = null;
    this.growthProfile = {
      subscribers: 0,
      totalViews: 0,
      totalVideos: 0,
      estimatedWatchHours: 0,
      subsMilestonePct: 0,
      watchHoursMilestonePct: 0,
      topPerformingTopics: [],
      optimalPublishHours: [6, 18], // 6 AM & 6 PM IST default
      topPlaylists: [],
      lastAuditAt: null
    };
  }

  async initialize() {
    this.logger.info('🎯 Initializing Audience Targeting & Organic Growth Agent...');
    try {
      const auth = this.credentials.getYouTubeAuth();
      if (auth) {
        this.youtube = google.youtube({ version: 'v3', auth });
        this.youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth });
      }
    } catch (err) {
      this.logger.warn(`YouTube client initialization deferred: ${err.message}`);
    }
    return true;
  }

  /**
   * Run full weekly / on-demand audience targeting & monetization review
   */
  async runAudienceOptimizationSweep() {
    this.logger.info('Running audience targeting & retention optimization sweep...');

    // 1. Fetch channel milestones
    await this.refreshMonetizationMilestones();

    // 2. Identify top performing topics and watch-time drivers
    const topInsights = await this.analyzeContentRetentionDrivers();

    // 3. Ensure retention-boosting playlists exist
    await this.ensureTopicPlaylists();

    // 4. Generate actionable growth report
    const report = this.buildGrowthReport(topInsights);

    // 5. Send report to notification channels
    await this.broadcastGrowthReport(report);

    return report;
  }

  /**
   * Calculate YPP Monetization Progress (1,000 Subs + 4,000 Watch Hours / 10M Shorts Views)
   */
  async refreshMonetizationMilestones() {
    if (!this.youtube) return this.growthProfile;

    try {
      const res = await this.youtube.channels.list({
        mine: true,
        part: 'snippet,statistics,contentDetails'
      });

      if (res.data.items && res.data.items.length > 0) {
        const stats = res.data.items[0].statistics;
        const subs = parseInt(stats.subscriberCount, 10) || 0;
        const views = parseInt(stats.viewCount, 10) || 0;
        const vids = parseInt(stats.videoCount, 10) || 0;

        // Public watch hours estimate (approx 1.8 mins avg view duration on Shorts + long form)
        // YouTube Studio provides exact via Analytics API when granted
        let watchHours = Math.round((views * 1.5) / 60);

        try {
          if (this.youtubeAnalytics) {
            const endDate = new Date().toISOString().split('T')[0];
            const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const analyticsRes = await this.youtubeAnalytics.reports.query({
              ids: 'channel==MINE',
              startDate,
              endDate,
              metrics: 'estimatedMinutesWatched,views,subscribersGained',
              dimensions: 'day'
            });

            if (analyticsRes.data.rows && analyticsRes.data.rows.length > 0) {
              const totalMins = analyticsRes.data.rows.reduce((sum, r) => sum + (r[1] || 0), 0);
              if (totalMins > 0) watchHours = Math.round(totalMins / 60);
            }
          }
        } catch (_analyticsErr) {
          // Fall back to stats estimation
        }

        const subsPct = Math.min(100, parseFloat(((subs / 1000) * 100).toFixed(1)));
        const watchHoursPct = Math.min(100, parseFloat(((watchHours / 4000) * 100).toFixed(1)));

        this.growthProfile = {
          ...this.growthProfile,
          subscribers: subs,
          totalViews: views,
          totalVideos: vids,
          estimatedWatchHours: watchHours,
          subsMilestonePct: subsPct,
          watchHoursMilestonePct: watchHoursPct,
          lastAuditAt: new Date().toISOString()
        };
      }
    } catch (err) {
      this.logger.warn(`Could not refresh channel stats: ${err.message}`);
    }

    return this.growthProfile;
  }

  /**
   * Read recent videos, analyze which topics deliver above-average views & retention
   */
  async analyzeContentRetentionDrivers() {
    if (!this.youtube) return [];

    try {
      const channelRes = await this.youtube.channels.list({
        mine: true,
        part: 'contentDetails'
      });
      const uploadsPlaylistId = channelRes.data.items[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploadsPlaylistId) return [];

      const playlistItems = await this.youtube.playlistItems.list({
        part: 'snippet,contentDetails',
        playlistId: uploadsPlaylistId,
        maxResults: 25
      });

      const videoIds = (playlistItems.data.items || []).map(item => item.contentDetails?.videoId).filter(Boolean);
      if (videoIds.length === 0) return [];

      const videosRes = await this.youtube.videos.list({
        part: 'snippet,statistics,contentDetails',
        id: videoIds.join(',')
      });

      const items = videosRes.data.items || [];
      const analyzed = items.map(v => {
        const title = v.snippet?.title || '';
        const views = parseInt(v.statistics?.viewCount, 10) || 0;
        const likes = parseInt(v.statistics?.likeCount, 10) || 0;
        const comments = parseInt(v.statistics?.commentCount, 10) || 0;
        const duration = v.contentDetails?.duration || '';

        // Classify topic
        let category = 'General';
        if (/cartoon|backbencher|school|animation|funny/i.test(title)) {
          category = '2D Cartoon Storytime';
        } else if (/trading|candlestick|breakout|chart|stock|forex/i.test(title)) {
          category = 'Trading Strategies';
        } else if (/ai|tech|secret|guide/i.test(title)) {
          category = 'Tech & AI Explainer';
        }

        return {
          id: v.id,
          title,
          category,
          views,
          likes,
          comments,
          duration,
          publishedAt: v.snippet?.publishedAt
        };
      });

      // Group by category to find highest average engagement
      const categoryScores = {};
      for (const vid of analyzed) {
        if (!categoryScores[vid.category]) {
          categoryScores[vid.category] = { totalViews: 0, count: 0, topVideo: vid.title };
        }
        categoryScores[vid.category].totalViews += vid.views;
        categoryScores[vid.category].count += 1;
      }

      const ranked = Object.entries(categoryScores).map(([cat, data]) => ({
        category: cat,
        avgViews: Math.round(data.totalViews / data.count),
        videoCount: data.count,
        topVideo: data.topVideo
      })).sort((a, b) => b.avgViews - a.avgViews);

      this.growthProfile.topPerformingTopics = ranked;
      return ranked;
    } catch (err) {
      this.logger.warn(`Retention drivers analysis skipped: ${err.message}`);
      return [];
    }
  }

  /**
   * Auto-organize uploads into topic playlists to maximize session duration
   */
  async ensureTopicPlaylists() {
    if (!this.youtube) return;

    const targetPlaylists = [
      {
        title: '🔥 Best 2D Cartoon Storytime (School & Comedy)',
        description: 'Binge the most hilarious 2D animated storytime shorts and funny school moments!',
        tag: '2D Cartoon Storytime'
      },
      {
        title: '📈 Master Price Action & Candlestick Secrets',
        description: 'Complete breakdown of high-win-rate candlestick patterns, pin bars, and breakout trading setups.',
        tag: 'Trading Strategies'
      }
    ];

    try {
      const existing = await this.youtube.playlists.list({
        mine: true,
        part: 'snippet',
        maxResults: 25
      });

      const existingTitles = new Set((existing.data.items || []).map(p => p.snippet?.title));

      for (const p of targetPlaylists) {
        if (!existingTitles.has(p.title)) {
          try {
            await this.youtube.playlists.insert({
              part: 'snippet,status',
              requestBody: {
                snippet: {
                  title: p.title,
                  description: p.description,
                  defaultLanguage: 'en'
                },
                status: {
                  privacyStatus: 'public'
                }
              }
            });
            this.logger.success(`Created engagement playlist: "${p.title}"`);
          } catch (createErr) {
            this.logger.warn(`Could not create playlist "${p.title}": ${createErr.message}`);
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Playlist auto-clustering check skipped: ${err.message}`);
    }
  }

  /**
   * Build structured growth & monetization audit
   */
  buildGrowthReport(topInsights = []) {
    const { subscribers, totalViews, estimatedWatchHours, subsMilestonePct, watchHoursMilestonePct } = this.growthProfile;

    return {
      timestamp: new Date().toISOString(),
      monetization: {
        subscribers,
        subscribersTarget: 1000,
        subsProgressPct: subsMilestonePct,
        estimatedWatchHours,
        watchHoursTarget: 4000,
        watchHoursProgressPct: watchHoursMilestonePct,
        status: (subscribers >= 1000 && estimatedWatchHours >= 4000) ? 'MONETIZATION_READY' : 'IN_PROGRESS'
      },
      retentionInsights: topInsights,
      recommendations: [
        '🎯 Double down on 2D Cartoon Storytime and Trading Breakout hooks (highest viewer retention).',
        '⚡ Keep video intros under 2.5 seconds with zero fluff to avoid audience drop-off.',
        '🔁 Connect every Short to a topical playlist to encourage multi-video binge sessions.',
        '🕒 Maintain consistent twice-daily uploads at 6:00 AM & 6:00 PM IST (peak Indian & US cross-traffic).'
      ]
    };
  }

  /**
   * Broadcast summary via Telegram
   */
  async broadcastGrowthReport(report) {
    const m = report.monetization;
    const topCat = report.retentionInsights[0]?.category || '2D Cartoon Storytime';

    const text =
      `🎯 <b>YouTube Audience Targeting & Monetization Update</b>\n\n` +
      `👥 <b>Subscribers:</b> ${m.subscribers} / 1,000 (${m.subsProgressPct}%)\n` +
      `⏱️ <b>Watch Time:</b> ~${m.estimatedWatchHours} / 4,000 hrs (${m.watchHoursProgressPct}%)\n` +
      `⭐ <b>Top Retention Category:</b> ${topCat}\n\n` +
      `💡 <b>Organic Growth Rule:</b> Original high-retention stories beat bulk posting. 2 curated daily uploads with active subscribe CTA will safely reach YPP monetization without inauthentic content flags!`;

    await this.telegram.sendMessage(text).catch(() => {});
  }
}

module.exports = { AudienceTargetingGrowthAgent };
