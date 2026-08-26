const https = require('https');

class TelegramNotifier {
  constructor() {
    let creds = {};
    try {
      creds = require('../config/credentials.json');
    } catch (_err) {
      // Ignore missing file
    }

    this.token = process.env.TELEGRAM_BOT_TOKEN || creds.telegram?.botToken || creds.telegram?.token || '8982189452:AAHhudVjWJZ0v6WPgUJyU3mUkPgqF-C7FZk';
    this.channelId = process.env.TELEGRAM_CHANNEL_ID || creds.telegram?.channelId || creds.telegram?.chatId || '6207722743';
    this.enabled = Boolean(this.token);
  }

  async sendMessage(text) {
    if (!this.enabled) {
      console.log('[TelegramNotifier] Skipped (TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID not set)');
      return;
    }
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        chat_id: this.channelId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false
      });
      const options = {
        hostname: 'api.telegram.org',
        path: `/bot${this.token}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.ok) {
              console.log('[TelegramNotifier] Message sent successfully');
              resolve(parsed);
            } else {
              console.error('[TelegramNotifier] API error:', parsed.description);
              resolve(null);
            }
          } catch (e) {
            resolve(null);
          }
        });
      });
      req.on('error', (e) => {
        console.error('[TelegramNotifier] Request error:', e.message);
        resolve(null); // Don't reject — notification failure shouldn't crash the app
      });
      req.write(body);
      req.end();
    });
  }

  async notifyVideoPublished({ title, youtubeUrl, scheduledTime, topic }) {
    const IST = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'full',
      timeStyle: 'short'
    }).format(scheduledTime ? new Date(scheduledTime) : new Date());

    const message =
`🎬 <b>New YouTube Video Published!</b>

📌 <b>Title:</b> ${title}
🔗 <b>Link:</b> ${youtubeUrl}
🕒 <b>Published at:</b> ${IST} IST
🤖 <b>Topic:</b> ${topic || 'Auto-generated'}

✅ Video is now LIVE on YouTube!`;

    return this.sendMessage(message);
  }

  async notifyVideoScheduled({ title, scheduledTime, topic }) {
    const IST = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'full',
      timeStyle: 'short'
    }).format(scheduledTime ? new Date(scheduledTime) : new Date());

    const message =
`📅 <b>Video Scheduled!</b>

📌 <b>Title:</b> ${title}
🕒 <b>Scheduled for:</b> ${IST} IST
🤖 <b>Topic:</b> ${topic || 'Auto-generated'}

⏳ Will be published automatically at the scheduled time.`;

    return this.sendMessage(message);
  }

  async notifyError({ stage, error }) {
    const message =
`⚠️ <b>YouTube Automation Error</b>

❌ <b>Stage:</b> ${stage}
🔴 <b>Error:</b> ${error}
🕒 <b>Time:</b> ${new Date().toISOString()}`;

    return this.sendMessage(message);
  }

  // Auto-detect channel ID from getUpdates (called on startup)
  async detectChannelId() {
    if (this.channelId) return this.channelId;
    if (!this.token) return null;

    return new Promise((resolve) => {
      const options = {
        hostname: 'api.telegram.org',
        path: `/bot${this.token}/getUpdates?offset=-1&allowed_updates=["channel_post"]`,
        method: 'GET'
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.ok && parsed.result && parsed.result.length > 0) {
              const update = parsed.result[parsed.result.length - 1];
              const chatId = update.channel_post?.chat?.id || update.message?.chat?.id;
              if (chatId) {
                console.log(`[TelegramNotifier] Auto-detected channel ID: ${chatId}`);
                this.channelId = String(chatId);
                this.enabled = true;
                resolve(this.channelId);
                return;
              }
            }
            resolve(null);
          } catch (e) {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.end();
    });
  }
}

module.exports = { TelegramNotifier };
