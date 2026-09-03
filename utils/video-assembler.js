const fs = require('fs').promises;
const sharp = require('sharp');
const { runFFmpeg, getFFmpegPath } = require('./ffmpeg');
const { Logger } = require('./logger');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

class VideoAssembler {
  constructor() {
    this.logger = new Logger('VideoAssembler');
  }

  /**
   * Probe media duration in seconds using FFmpeg
   */
  async getDuration(filePath) {
    try {
      const ffmpeg = getFFmpegPath();
      const result = await execFileAsync(ffmpeg, ['-i', filePath, '-f', 'null', '-'], { maxBuffer: 10 * 1024 * 1024 }).catch(err => err);
      const output = (result.stderr || '') + (result.stdout || '');
      const match = output.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
      if (match) {
        const hours = parseFloat(match[1]);
        const mins = parseFloat(match[2]);
        const secs = parseFloat(match[3]);
        return hours * 3600 + mins * 60 + secs;
      }
    } catch (e) {
      this.logger.warn(`Could not probe duration for ${filePath}: ${e.message}`);
    }
    return null;
  }

  /**
   * Generate a sleek transparent lower-third banner PNG for a segment
   */
  async createLowerThirdOverlay(options, outputPath) {
    const {
      title = '',
      subtitle = '',
      badge = '',
      isShort = false
    } = options;

    const width = isShort ? 1080 : 1920;
    const height = isShort ? 1920 : 1080;

    const safeTitle = String(title).slice(0, 60).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;');
    const safeSub = String(subtitle).slice(0, 100).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;');
    const safeBadge = String(badge).toUpperCase().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;');

    const cardWidth = isShort ? 940 : 1400;
    const cardHeight = isShort ? 260 : 180;
    const cardX = Math.floor((width - cardWidth) / 2);
    const cardY = isShort ? height - 460 : height - 260;

    const badgeY = cardY + 42;
    const titleY = cardY + (isShort ? 115 : 95);
    const subY = cardY + (isShort ? 185 : 145);

    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#020617" stop-opacity="0.88"/>
          <stop offset="100%" stop-color="#0f172a" stop-opacity="0.85"/>
        </linearGradient>
        <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#38bdf8"/>
          <stop offset="100%" stop-color="#818cf8"/>
        </linearGradient>
        <filter id="shadow" x="-5%" y="-10%" width="110%" height="130%">
          <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.65"/>
        </filter>
      </defs>

      <!-- Sleek Glassmorphism Lower-Third Card -->
      <g filter="url(#shadow)">
        <rect x="${cardX}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" rx="20" ry="20" fill="url(#bgGrad)" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
        <!-- Accent line indicator -->
        <rect x="${cardX + 24}" y="${cardY + 16}" width="6" height="${cardHeight - 32}" rx="3" fill="url(#accentGrad)"/>
      </g>

      <!-- Badge -->
      ${safeBadge ? `<text x="${cardX + 48}" y="${badgeY}" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="700" letter-spacing="2" fill="#38bdf8">${safeBadge}</text>` : ''}

      <!-- Main Headline -->
      <text x="${cardX + 48}" y="${titleY}" font-family="system-ui, -apple-system, sans-serif" font-size="${isShort ? 38 : 34}" font-weight="800" fill="#ffffff">${safeTitle}</text>

      <!-- Subtitle / Takeaway -->
      ${safeSub ? `<text x="${cardX + 48}" y="${subY}" font-family="system-ui, -apple-system, sans-serif" font-size="${isShort ? 24 : 21}" font-weight="500" fill="#cbd5e1">${safeSub}</text>` : ''}
    </svg>`;

    await sharp(Buffer.from(svg)).png().toFile(outputPath);
    return outputPath;
  }

  /**
   * Normalize an input asset (video or image) to standardized 1080p 30fps clip of exact duration
   */
  async normalizeSegment(inputPath, duration, outputPath, options = {}) {
    const isShort = Boolean(options.isShort);
    const targetW = isShort ? 1080 : 1920;
    const targetH = isShort ? 1920 : 1080;
    const overlayPath = options.overlayPath;

    const isImage = /\.(jpg|jpeg|png|webp)$/i.test(inputPath);

    if (isImage) {
      // Image input: use Ken Burns slow zoom (zoompan filter)
      const frames = Math.max(30, Math.round(duration * 30));
      let filter = `zoompan=z='min(zoom+0.0015,1.20)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${targetW}x${targetH}:fps=30,format=yuv420p`;
      
      const args = [
        '-y',
        '-loop', '1',
        '-t', duration.toFixed(2),
        '-i', inputPath
      ];

      if (overlayPath) {
        args.push('-i', overlayPath);
        filter = `[0:v]${filter}[base];[base][1:v]overlay=0:0:eof_action=repeat[outv]`;
        args.push('-filter_complex', filter, '-map', '[outv]');
      } else {
        args.push('-vf', filter);
      }

      args.push(
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-an',
        outputPath
      );

      await runFFmpeg(args);
      return outputPath;
    }

    // Video input: scale, crop to target aspect, loop if shorter than duration
    let vFilter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1,fps=30,format=yuv420p`;

    const args = [
      '-y',
      '-stream_loop', '-1',
      '-t', duration.toFixed(2),
      '-i', inputPath
    ];

    if (overlayPath) {
      args.push('-i', overlayPath);
      const complex = `[0:v]${vFilter}[base];[base][1:v]overlay=0:0:eof_action=repeat[outv]`;
      args.push('-filter_complex', complex, '-map', '[outv]');
    } else {
      args.push('-vf', vFilter);
    }

    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-an',
      outputPath
    );

    await runFFmpeg(args);
    return outputPath;
  }

  /**
   * Concat normalized video segments with crossfade (xfade) transitions
   */
  async concatenateSegments(segments, outputPath) {
    if (!segments || segments.length === 0) {
      throw new Error('No segments provided for video concatenation');
    }

    if (segments.length === 1) {
      await fs.copyFile(segments[0].path, outputPath);
      return outputPath;
    }

    const fade = 0.5;
    const args = ['-y'];

    for (const seg of segments) {
      args.push('-i', seg.path);
    }

    const filterParts = [];
    let accumulatedDuration = segments[0].duration;
    let prevStream = '[0:v]';

    for (let i = 1; i < segments.length; i++) {
      const outStream = `[v${i}]`;
      const offset = Math.max(0.1, accumulatedDuration - (i * fade)).toFixed(2);
      filterParts.push(`${prevStream}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${offset}${outStream}`);
      prevStream = outStream;
      accumulatedDuration += segments[i].duration;
    }

    filterParts.push(`${prevStream}format=yuv420p[finalv]`);

    args.push(
      '-filter_complex', filterParts.join(';'),
      '-map', '[finalv]',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-r', '30',
      '-pix_fmt', 'yuv420p',
      outputPath
    );

    try {
      await runFFmpeg(args);
      return outputPath;
    } catch (err) {
      this.logger.warn(`xfade concatenation failed, falling back to concat filter: ${err.message}`);
      return await this.fallbackConcat(segments, outputPath);
    }
  }

  /**
   * Fallback concat using standard concat filter if xfade fails
   */
  async fallbackConcat(segments, outputPath) {
    const args = ['-y'];
    for (const seg of segments) {
      args.push('-i', seg.path);
    }

    const filterInputs = segments.map((_, idx) => `[${idx}:v]`).join('');
    const filter = `${filterInputs}concat=n=${segments.length}:v=1:a=0[outv];[outv]format=yuv420p[finalv]`;

    args.push(
      '-filter_complex', filter,
      '-map', '[finalv]',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-r', '30',
      outputPath
    );

    await runFFmpeg(args);
    return outputPath;
  }

  /**
   * Mux narration audio with video stream
   */
  async muxAudio(videoPath, audioPath, outputPath) {
    const hasAudio = audioPath && await fs.stat(audioPath).then(s => s.size > 1000).catch(() => false);

    if (!hasAudio) {
      this.logger.warn('No valid audio narration found — saving video without audio');
      if (videoPath !== outputPath) {
        await fs.copyFile(videoPath, outputPath);
      }
      return outputPath;
    }

    const tempMux = outputPath === videoPath ? outputPath.replace(/\.mp4$/i, '_muxed.mp4') : outputPath;

    await runFFmpeg([
      '-y',
      '-i', videoPath,
      '-i', audioPath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      tempMux
    ]);

    if (tempMux !== outputPath) {
      await fs.rename(tempMux, outputPath);
    }

    return outputPath;
  }
}

module.exports = { VideoAssembler };
