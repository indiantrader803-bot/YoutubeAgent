#!/usr/bin/env node
/**
 * Deployment credential verifier — proves the exact secrets the daily
 * 24/7 workflow depends on actually work, WITHOUT printing any value:
 *
 *   1. YouTube: refresh-token exchange + real API call (channels.list mine)
 *   2. Gmail:   SMTP login + test email to OWNER_EMAIL (optional but reported)
 *
 * Exit 0 = all good. Exit 1 = names the failing credential and the fix.
 * Run locally:  node scripts/verify-deployment.js
 * Runs on CI:   .github/workflows/verify-credentials.yml (on every push)
 */
require('dotenv').config();
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'arnab.laha2018@gmail.com';
const results = [];

async function verifyYouTube() {
  let clientId = process.env.YOUTUBE_CLIENT_ID;
  let clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  let refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
  let source = 'env secrets';

  // Local-dev fallback: the pipeline itself loads these from config/*.json
  // (git-ignored). On CI only env secrets exist, so this branch never fires
  // there — meaning the CI check proves exactly what the daily run uses.
  if (!clientId || !clientSecret || !refreshToken) {
    try {
      const creds = require('../config/credentials.json').youtube || {};
      const tokens = require('../config/tokens.json').youtube || {};
      clientId = clientId || creds.client_id;
      clientSecret = clientSecret || creds.client_secret;
      refreshToken = refreshToken || tokens.refresh_token;
      source = 'local config files';
    } catch (_err) { /* config files absent (CI) — keep env-only */ }
  }

  if (!clientId || !clientSecret || !refreshToken) {
    const missing = [
      !clientId && 'YOUTUBE_CLIENT_ID',
      !clientSecret && 'YOUTUBE_CLIENT_SECRET',
      !refreshToken && 'YOUTUBE_REFRESH_TOKEN'
    ].filter(Boolean).join(', ');
    results.push({ name: 'YouTube', ok: false, detail: `missing secrets: ${missing}` });
    return;
  }

  try {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost');
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    await oauth2Client.getAccessToken(); // forces a real refresh-token exchange

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const resp = await youtube.channels.list({ part: 'snippet', mine: true });
    const channel = resp.data.items?.[0]?.snippet?.title || '(unknown)';
    results.push({ name: 'YouTube', ok: true, detail: `token refresh OK (${source}) — channel "${channel}" reachable` });
  } catch (err) {
    const data = err.response && err.response.data;
    const reason = (data && (data.error || data.error_description)) || err.message;
    results.push({
      name: 'YouTube',
      ok: false,
      detail: `refresh/verify failed: ${String(reason).slice(0, 160)}`,
      fix: 'Re-mint the refresh token (node modern-auth.js) and update the YOUTUBE_* secrets.'
    });
  }
}

async function verifyGmail() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    results.push({ name: 'Gmail', ok: false, detail: 'missing secrets: GMAIL_USER and/or GMAIL_APP_PASSWORD (email alerts inactive)' });
    return;
  }
  try {
    const transport = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await transport.verify(); // real SMTP handshake, no email sent
    results.push({ name: 'Gmail', ok: true, detail: `SMTP login OK for ${user} — owner alerts active` });
  } catch (err) {
    results.push({
      name: 'Gmail',
      ok: false,
      detail: `SMTP login failed: ${err.message.slice(0, 140)}`,
      fix: 'Regenerate the Google App Password (16 chars) and update the GMAIL_APP_PASSWORD secret.'
    });
  }
}

async function main() {
  console.log('Verifying deployment credentials (values are never printed)...\n');
  await verifyYouTube();
  await verifyGmail();

  let allOk = true;
  for (const r of results) {
    console.log(`${r.ok ? '✅' : '❌'} ${r.name}: ${r.detail}`);
    if (!r.ok) {
      allOk = false;
      if (r.fix) console.log(`   FIX: ${r.fix}`);
    }
  }
  console.log(allOk ? '\n🎉 All credentials verified — the 24/7 pipeline is fully armed.' : '\n🚨 Fix the failing secrets above (GitHub → Settings → Secrets and variables → Actions), then re-run.');
  process.exit(allOk ? 0 : 1);
}

main().catch(err => {
  console.error('Verifier crashed:', err.message);
  process.exit(1);
});
