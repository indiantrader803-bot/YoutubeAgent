#!/usr/bin/env node
/**
 * Workflow failure alerter: fires when the daily run published nothing.
 * Sends Telegram + email (to the channel owner) with the exact recovery
 * steps. Never throws — alerting must not crash the workflow's own exit.
 */
require('dotenv').config();
const { TelegramNotifier } = require('../utils/telegram-notifier');
const { EmailNotifier } = require('../utils/email-notifier');

async function main() {
  const reason = process.argv.slice(2).join(' ') || 'no video was published in this run';
  const runId = process.env.GITHUB_RUN_ID || '';
  const runUrl = runId ? `https://github.com/${process.env.GITHUB_REPOSITORY || ''}/actions/runs/${runId}` : '(see Actions tab)';

  const telegram = new TelegramNotifier();
  await telegram.sendMessage(
    `🚨 <b>Daily automation FAILED</b> — ${reason}.\nLog: ${runUrl}`
  ).catch(() => {});

  const email = new EmailNotifier();
  await email.sendManualActionNeeded(
    'daily YouTube automation failed',
    [
      'Open the failed workflow log: ' + runUrl,
      'Most common cause — YouTube credentials on the repo are missing/stale. Fix:',
      '  GitHub repo → Settings → Secrets and variables → Actions, set:',
      '   • YOUTUBE_CLIENT_ID      ← config/credentials.json → youtube.client_id',
      '   • YOUTUBE_CLIENT_SECRET  ← config/credentials.json → youtube.client_secret',
      '   • YOUTUBE_REFRESH_TOKEN  ← config/tokens.json → youtube.refresh_token',
      'Then: Actions tab → "24/7 Serverless Daily Video Automation" → Re-run all jobs.',
      'If Gmail setup is pending (for these alerts), also create a Google App Password',
      ' and set GMAIL_USER + GMAIL_APP_PASSWORD secrets.'
    ]
  ).catch(() => {});
}

main().then(() => process.exit(0)).catch(() => process.exit(0));
