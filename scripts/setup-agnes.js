#!/usr/bin/env node
/**
 * One-time (or repair) setup for the vendored Agnes Video Generator renderer:
 *   node scripts/setup-agnes.js            → create venv + pip install + report status
 *   node scripts/setup-agnes.js --start    → also start the service (blocks; Ctrl+C to stop)
 *
 * What this does:
 *   1. Finds Python 3.10+ on PATH.
 *   2. Creates vendor/agnes-video-generator/.venv (first run only).
 *   3. pip installs the pinned requirements (moviepy, edge-tts, imageio-ffmpeg…).
 *
 * The service needs one free key from https://platform.agnes-ai.com in
 * AGNES_API_KEY (put it in .env). Without a key the automation simply keeps
 * using the FFmpeg chain — this script never blocks that.
 */
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const AGNES_DIR = path.join(__dirname, '..', 'vendor', 'agnes-video-generator');
const isWin = process.platform === 'win32';
const venvPython = isWin
  ? path.join(AGNES_DIR, '.venv', 'Scripts', 'python.exe')
  : path.join(AGNES_DIR, '.venv', 'bin', 'python');

function findPython() {
  for (const cmd of ['python3', 'python']) {
    try {
      const out = execSync(`"${cmd}" --version`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      const m = out.match(/Python (\d+)\.(\d+)/);
      if (m && (parseInt(m[1], 10) > 3 || (parseInt(m[1], 10) === 3 && parseInt(m[2], 10) >= 10))) {
        return cmd;
      }
    } catch (_) { /* try next */ }
  }
  return null;
}

function main() {
  if (!fs.existsSync(path.join(AGNES_DIR, 'server.py'))) {
    console.error('✗ vendor/agnes-video-generator is missing. Re-clone it into the repo:');
    console.error('  git clone --depth 1 https://github.com/lcy362/agnes-video-generator.git vendor/agnes-video-generator');
    process.exit(1);
  }

  const py = findPython();
  if (!py) {
    console.error('✗ Python 3.10+ not found on PATH. Install it from https://www.python.org/downloads/');
    process.exit(1);
  }
  console.log(`✓ Using ${py}`);

  if (!fs.existsSync(venvPython)) {
    console.log('[1/2] Creating virtual environment…');
    execSync(`"${py}" -m venv "${path.join(AGNES_DIR, '.venv')}"`, { stdio: 'inherit' });
  } else {
    console.log('[1/2] Virtual environment already exists');
  }

  console.log('[2/2] Installing Python dependencies (first run takes a few minutes)…');
  execSync(`"${venvPython}" -m pip install -q -r "${path.join(AGNES_DIR, 'requirements.txt')}"`, { stdio: 'inherit' });

  console.log('');
  console.log('✅ Agnes renderer installed.');
  if (!process.env.AGNES_API_KEY) {
    console.log('ℹ️  AGNES_API_KEY is not set — get a free key at https://platform.agnes-ai.com');
    console.log('   and add it to .env to activate the renderer. Until then the');
    console.log('   automation uses the local FFmpeg chain as before.');
  }
  console.log('Start manually any time with:  node vendor/agnes-video-generator/bin/cli.js --port 8765 --no-open');

  if (process.argv.includes('--start')) {
    console.log('Starting service… (Ctrl+C to stop)');
    const child = spawn(venvPython, ['server.py'], {
      cwd: AGNES_DIR,
      env: { ...process.env, HOST: '127.0.0.1', PORT: '8765' },
      stdio: 'inherit'
    });
    child.on('exit', code => process.exit(code === null ? 0 : code));
  }
}

main();
