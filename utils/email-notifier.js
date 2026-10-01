const nodemailer = require('nodemailer');

// Every action that physically requires the channel owner lands here.
// Reused for critical failure alerts too, because email outlives
// token outages better than any in-app channel.
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'arnab.laha2018@gmail.com';

function buildTransport() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD; // Google Account → Security → App passwords
  if (user && pass) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass }
    });
  }
  return null;
}

class EmailNotifier {
  constructor() {
    this.transport = buildTransport();
    this.to = OWNER_EMAIL;
    this.from = process.env.GMAIL_USER || 'youtube-automation-agent@localhost';
    this.lastError = null;
  }

  get enabled() {
    return Boolean(this.transport);
  }

  /**
   * Core send. Never throws — notification failure must not break a run —
   * but records the error so callers can fall back to Telegram/log-only.
   */
  async send(subject, text, { critical = false } = {}) {
    if (!this.transport) {
      this.lastError = 'GMAIL_USER / GMAIL_APP_PASSWORD not configured';
      console.log(`[EmailNotifier] Skipped (no SMTP creds): ${subject}`);
      return false;
    }
    const prefixed = critical ? `🚨 ${subject}` : subject;
    try {
      const info = await this.transport.sendMail({
        from: this.from,
        to: this.to,
        subject: prefixed,
        text
      });
      console.log(`[EmailNotifier] Sent "${prefixed}" to ${this.to} (${info.messageId})`);
      return true;
    } catch (err) {
      this.lastError = err.message;
      console.error(`[EmailNotifier] Send failed: ${err.message}`);
      return false;
    }
  }

  /** Manual action needed from the channel owner (re-auth, policy notice, quota, …). */
  async sendManualActionNeeded(subject, steps) {
    const body = [
      'Your YouTube automation needs a manual step from you.',
      '',
      'WHAT TO DO:',
      ...steps.map((s, i) => `  ${i + 1}. ${s}`),
      '',
      'Why you got this: the automation is designed never to silently skip a day.',
      'Until this step is done, runs will keep failing loudly instead of pretending success.',
      '',
      `— YouTube Automation Agent (${new Date().toISOString()})`
    ].join('\n');
    return this.send(`ACTION NEEDED: ${subject}`, body, { critical: true });
  }

  /** Batch verdict / daily summary to the owner's inbox. */
  async sendDailySummary(text) {
    return this.send('Daily YouTube automation summary', text);
  }

  /** Critical pipeline failure escalation. */
  async sendCriticalAlert(subject, text) {
    return this.send(subject, text, { critical: true });
  }
}

module.exports = { EmailNotifier, OWNER_EMAIL };
