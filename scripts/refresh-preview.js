#!/usr/bin/env node
/**
 * Rebuilds the temp/preview/ folder from scratch/preview-results.json so the
 * preview page always shows the most recently generated videos.
 *
 * Usage: node scripts/refresh-preview.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Database } = require('../database/db');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'temp', 'preview');
const RESULTS = path.join(ROOT, 'scratch', 'preview-results.json');
const FFMPEG = require('ffmpeg-static');
// Frame positions as a fraction of the video, so a 40s Short and a 3min
// long-form both get the same number of usable frames.
const FRAME_FRACTIONS = [0.08, 0.32, 0.58, 0.85];
const LABELS = ['short', 'long'];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Video duration in seconds, or null if ffmpeg could not probe it. */
function durationSeconds(file) {
  let probe = '';
  try {
    probe = execFileSync(FFMPEG, ['-i', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    // ffmpeg writes probe output to stderr and exits non-zero with no output file.
    probe = String(error.stderr || '');
  }
  const match = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(probe);
  return match ? (+match[1]) * 3600 + (+match[2]) * 60 + (+match[3]) : null;
}

/** Extracts frames and returns the names of the ones actually written. */
function extractFrames(video, label, seconds) {
  const used = new Set();
  const frames = [];
  FRAME_FRACTIONS.forEach((fraction) => {
    if (!seconds) return;
    const at = Math.max(0.5, Math.round(seconds * fraction * 10) / 10);
    if (used.has(at)) return;
    used.add(at);
    const name = `${label}_frame_${String(at).replace('.', '_')}s.jpg`;
    try {
      execFileSync(FFMPEG, ['-y', '-ss', String(at), '-i', video, '-frames:v', '1', '-q:v', '3', path.join(OUT, name), '-loglevel', 'error']);
      frames.push({ file: name, at });
      console.log(`  frame at ${at}s`);
    } catch (error) {
      console.warn(`  frame @${at}s failed: ${error.message}`);
    }
  });
  return frames;
}

async function main() {
  if (!fs.existsSync(RESULTS)) {
    console.error(`No results file at ${RESULTS}. Run scripts/generate-preview-videos.js first.`);
    process.exit(1);
  }
  ensureDir(OUT);

  const results = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));

  // Surface the live YouTube URLs when these videos have already been published.
  const published = new Map();
  try {
    const db = new Database();
    await db.initialize();
    const rows = await db.getAllRows(
      "SELECT production_id, youtube_url FROM publish_schedule WHERE youtube_id IS NOT NULL AND youtube_id != ''"
    );
    rows.forEach((row) => published.set(row.production_id, row.youtube_url));
  } catch (error) {
    console.warn(`Could not read published URLs: ${error.message}`);
  }

  const meta = [];

  results.forEach((item, index) => {
    const label = LABELS[index] || `video${index}`;
    let frames = [];
    let seconds = null;

    if (item.videoPath && fs.existsSync(item.videoPath)) {
      fs.copyFileSync(item.videoPath, path.join(OUT, `${label}_video.mp4`));
      seconds = durationSeconds(item.videoPath);
      console.log(`[${label}] video copied (${seconds ? `${seconds.toFixed(1)}s` : 'unknown duration'})`);
      frames = extractFrames(item.videoPath, label, seconds);
    } else {
      console.warn(`[${label}] video missing: ${item.videoPath}`);
    }

    if (item.thumbnailPath && fs.existsSync(item.thumbnailPath)) {
      fs.copyFileSync(item.thumbnailPath, path.join(OUT, `${label}_thumbnail.jpg`));
      console.log(`[${label}] thumbnail copied`);
    } else {
      console.warn(`[${label}] thumbnail missing: ${item.thumbnailPath}`);
    }

    meta.push({
      topic: item.topic,
      title: item.title,
      tags: item.seo?.tags || [],
      description: item.seo?.description || '',
      thumbnail: item.thumbnailPath && fs.existsSync(item.thumbnailPath) ? `${label}_thumbnail.jpg` : null,
      durationSeconds: seconds === null ? null : Math.round(seconds * 10) / 10,
      frames,
      youtubeUrl: published.get(item.id) || null
    });
  });

  fs.writeFileSync(path.join(OUT, 'preview-metadata.json'), JSON.stringify(meta, null, 2));
  console.log(`\nPreview refreshed: ${meta.length} video(s) -> temp/preview/`);
  console.log('Reload the preview tab to pick up the new assets.');
}

main().catch((error) => {
  console.error('Preview refresh failed:', error.message);
  process.exit(1);
});
