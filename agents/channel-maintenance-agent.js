const { Logger } = require('../utils/logger');
const { EmailNotifier } = require('../utils/email-notifier');

// Channel theme packs rotate monthly so the brand stays fresh but consistent.
// Applied via the YouTube Data API channels.update (brandingSettings).
const THEME_PACKS = [
  {
    id: 'ai-future-explorer',
    keywords: 'ai stories, future tech, artificial intelligence, cartoon storytime, explainer animation, trending ai, BROblox',
    description: [
      'Welcome to BROblox 🚀 — daily AI-powered cartoon storytime, future-tech explainers and mind-bending shorts.',
      'New videos every single day: one deep-dive long-form plus three bite-sized Shorts.',
      'Hit subscribe and ring the bell so the algorithm shows you tomorrow\'s story first.'
    ].join('\n')
  },
  {
    id: 'space-and-beyond',
    keywords: 'space facts, universe storytime, astronomy cartoons, science shorts, what if scenarios, cosmic explainers, BROblox',
    description: [
      'Welcome to BROblox 🌌 — daily space storytime, "what if" cosmic scenarios and science Shorts.',
      'One deep-dive long-form plus three Shorts, every single day, fully animated.',
      'Subscribe so the universe lands in your feed first.'
    ].join('\n')
  },
  {
    id: 'mind-psychology',
    keywords: 'dark psychology, human mind facts, psychology storytime, brain tricks, self improvement shorts, BROblox',
    description: [
      'Welcome to BROblox 🧠 — daily psychology storytime, mind hacks and human-behavior Shorts.',
      'One long-form plus three Shorts daily — learn something about your own head every day.',
      'Subscribe — your brain will thank you.'
    ].join('\n')
  },
  {
    id: 'history-unlocked',
    keywords: 'history storytime, what if history, animated history, medieval life, ancient facts, history shorts, BROblox',
    description: [
      'Welcome to BROblox 🏛️ — daily animated history storytime and alternate-history Shorts.',
      'A day in the life of the past, reimagined every single day.',
      'Subscribe to time-travel daily.'
    ].join('\n')
  },
  {
    id: 'survival-smarts',
    keywords: 'survival tips, survival storytime, emergency prep, survival skills shorts, outdoor hacks, BROblox',
    description: [
      'Welcome to BROblox 🧭 — daily survival storytime, skills and scenario Shorts.',
      'What you learn here might save your life someday — one long-form and three Shorts daily.',
      'Subscribe and stay ready.'
    ].join('\n')
  }
];

class ChannelMaintenanceAgent {
  constructor(db, credentials) {
    this.db = db;
    this.credentials = credentials;
    this.logger = new Logger('ChannelMaintenance');
    this.email = new EmailNotifier();
    this.channelId = process.env.YOUTUBE_CHANNEL_ID || 'UCKEmZ2F21yH9B5j2ubiWUbQ';
  }

  async initialize() {
    this.logger.info(`Channel maintenance agent initialized (email alerts ${this.email.enabled ? 'ON' : 'OFF — set GMAIL_USER/GMAIL_APP_PASSWORD'})`);
    return true;
  }

  /**
   * Monthly theme refresh: rotates the channel's branding pack via AI opinion
   * + the rotation schedule. Keeps the store front updated without human work.
   */
  async refreshChannelTheme(runIndex) {
    const theme = THEME_PACKS[((runIndex % THEME_PACKS.length) + THEME_PACKS.length) % THEME_PACKS.length];
    try {
      const { google } = require('googleapis');
      const auth = this.credentials.getYouTubeAuth();
      const youtube = google.youtube({ version: 'v3', auth });

      const current = await youtube.channels.list({ part: 'brandingSettings', id: [this.channelId] });
      const branding = current.data.items?.[0]?.brandingSettings || {};
      const currentDescription = branding.channel?.description || '';

      // Skip if the theme is already applied (idempotent re-runs).
      if (currentDescription === theme.description) {
        this.logger.info(`Theme "${theme.id}" already applied`);
        return { changed: false, theme: theme.id };
      }

      await youtube.channels.update({
        part: 'brandingSettings',
        requestBody: {
          id: this.channelId,
          brandingSettings: {
            ...branding,
            channel: {
              ...branding.channel,
              keywords: theme.keywords,
              description: theme.description
            }
          }
        }
      });
      this.logger.success(`Channel theme refreshed → "${theme.id}"`);
      return { changed: true, theme: theme.id };
    } catch (err) {
      this.logger.error(`Theme refresh failed: ${err.message}`);
      return { changed: false, error: err.message, theme: theme.id };
    }
  }

  /**
   * Weekly channel health audit: public uploads present, no hidden/private
   * stragglers, metadata sanity, queue depth. Emails the owner when a
   * problem needs human eyes.
   */
  async runWeeklyHealthAudit(publishingAgent) {
    const problems = [];
    let stats = null;
    try {
      const { google } = require('googleapis');
      const auth = this.credentials.getYouTubeAuth();
      const youtube = google.youtube({ version: 'v3', auth });

      const search = await youtube.search.list({
        part: 'snippet',
        channelId: this.channelId,
        order: 'date',
        maxResults: 25,
        type: 'video'
      });
      const ids = (search.data.items || []).map(it => it.id?.videoId).filter(Boolean);
      if (ids.length === 0) {
        problems.push('Channel appears to have no public videos (search returned empty) — check upload status.');
      }
      if (ids.length > 0) {
        const vids = await youtube.videos.list({
          part: 'status,snippet',
          id: ids
        });
        const priv = (vids.data.items || []).filter(v => v.status.privacyStatus !== 'public');
        if (priv.length > 0) {
          problems.push(`${priv.length} recent video(s) are not public: ${priv.map(v => v.id).join(', ')}`);
        }
        const missingTags = (vids.data.items || []).filter(v => !(v.snippet.tags || []).length);
        if (missingTags.length > 0) {
          problems.push(`${missingTags.length} recent video(s) have zero tags (search visibility loss).`);
        }
      }
      stats = { recentVideos: ids.length };
    } catch (err) {
      problems.push(`Health audit could not reach the YouTube API: ${err.message}`);
    }

    // Queue depth check
    try {
      const queueLen = publishingAgent?.publishQueue?.length;
      if (typeof queueLen === 'number' && queueLen > 12) {
        problems.push(`Publish queue backlog: ${queueLen} items waiting — check for repeated upload failures.`);
      }
    } catch (_err) { /* queue optional */ }

    const healthy = problems.length === 0;
    const report = [
      `Channel health audit — ${new Date().toISOString()}`,
      healthy ? '✅ All checks passed.' : `⚠️ ${problems.length} issue(s):`,
      ...problems.map(p => `  • ${p}`)
    ].join('\n');
    this.logger[healthy ? 'info' : 'warn'](report);

    if (!healthy && this.email.enabled) {
      await this.email.sendCriticalAlert(
        'Channel health issues detected',
        `${report}\n\nThe automation keeps running, but these need your attention.`
      );
    }
    return { healthy, problems, stats };
  }

  /**
   * Policy-hygiene sweep: fetches recent uploads' metadata and looks for
   * accidental policy traps (all-caps spam titles, dup titles, missing
   * descriptions). Auto-fixes titles where possible, reports the rest.
   */
  async runPolicyHygieneSweep() {
    const findings = { checked: 0, fixed: 0, issues: [] };
    try {
      const { google } = require('googleapis');
      const auth = this.credentials.getYouTubeAuth();
      const youtube = google.youtube({ version: 'v3', auth });

      const search = await youtube.search.list({
        part: 'snippet', channelId: this.channelId, order: 'date', maxResults: 25, type: 'video'
      });
      const ids = (search.data.items || []).map(it => it.id?.videoId).filter(Boolean);
      if (ids.length === 0) return findings;

      const vids = await youtube.videos.list({ part: 'snippet', id: ids });
      const seenTitles = new Map();
      for (const v of vids.data.items || []) {
        findings.checked++;
        const title = v.snippet.title || '';
        const updates = {};

        if (title === title.toUpperCase() && /\w/.test(title)) {
          updates.title = title.charAt(0) + title.slice(1).toLowerCase();
          findings.issues.push(`${v.id}: all-caps title softened`);
        }
        if ((v.snippet.description || '').trim().length < 30) {
          findings.issues.push(`${v.id}: description too short for search`);
        }
        if (seenTitles.has(title)) {
          findings.issues.push(`${v.id}: duplicate title with ${seenTitles.get(title)}`);
        }
        seenTitles.set(title, v.id);

        if (Object.keys(updates).length > 0) {
          try {
            await youtube.videos.update({
              part: 'snippet',
              requestBody: { id: v.id, snippet: { ...v.snippet, ...updates } }
            });
            findings.fixed++;
          } catch (err) {
            findings.issues.push(`${v.id}: auto-fix failed (${err.message})`);
          }
        }
      }
    } catch (err) {
      findings.issues.push(`Sweep could not reach the YouTube API: ${err.message}`);
    }

    if (findings.issues.length > 0 && this.email.enabled) {
      await this.email.send(
        'Channel policy hygiene report',
        `Checked ${findings.checked} videos. Auto-fixed ${findings.fixed}.\n\nIssues:\n${findings.issues.map(i => `  • ${i}`).join('\n')}`
      );
    }
    this.logger.info(`Policy hygiene: checked ${findings.checked}, fixed ${findings.fixed}, issues ${findings.issues.length}`);
    return findings;
  }

  static get THEME_PACKS() {
    return THEME_PACKS;
  }
}

module.exports = { ChannelMaintenanceAgent, THEME_PACKS };
