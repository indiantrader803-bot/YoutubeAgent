#!/usr/bin/env node
/**
 * Quick status check for the vendored Agnes Video Generator renderer.
 *   node scripts/agnes-status.js
 *
 * Verifies: repo present, venv installed, key set, service responding,
 * FFmpeg available (for the fallback chain). Exit code 0 = fully ready.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const AGNES_DIR = path.join(__dirname, '..', 'vendor', 'agnes-video-generator');
const isWin = process.platform === 'win32';
const venvPython = isWin
  ? path.join(AGNES_DIR, '.venv', 'Scripts', 'python.exe')
  : path.join(AGNES_DIR, '.venv', 'bin', 'python');

async function main() {
  let ok = true;

  const repoPresent = fs.existsSync(path.join(AGNES_DIR, 'server.py'));
  console.log(`${repoPresent ? '✓' : '✗'} vendored repo (vendor/agnes-video-generator)`);
  ok = ok && repoPresent;

  const venvInstalled = fs.existsSync(venvPython);
  console.log(`${venvInstalled ? '✓' : '✗'} Python venv installed ${venvInstalled ? '' : '(run: node scripts/setup-agnes.js)'}`);
  ok = ok && venvInstalled;

  const keySet = Boolean(process.env.AGNES_API_KEY);
  console.log(`${keySet ? '✓' : '✗'} AGNES_API_KEY set ${keySet ? '' : '(free key: https://platform.agnes-ai.com)'}`);
  ok = ok && keySet;

  if (keySet && venvInstalled) {
    try {
      const axios = require('axios');
      const port = process.env.AGNES_PORT || '8765';
      await axios.get(`http://127.0.0.1:${port}/api/health`, { timeout: 3000 });
      console.log('✓ Agnes service responding on port ' + port);
    } catch (_) {
      console.log('✗ Agnes service not running (start: node vendor/agnes-video-generator/bin/cli.js --port 8765 --no-open)');
      ok = false;
    }
  }

  try {
    const { checkFFmpeg } = require('../utils/ffmpeg');
    const hasFFmpeg = await checkFFmpeg();
    console.log(`${hasFFmpeg ? '✓' : '✗'} FFmpeg available (fallback render chain)`);
    ok = ok && hasFFmpeg;
  } catch (_) {
    console.log('? could not check FFmpeg');
  }

  process.exit(ok ? 0 : 1);
}

main();
