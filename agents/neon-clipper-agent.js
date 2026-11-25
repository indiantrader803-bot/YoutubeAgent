const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const { Logger } = require('../utils/logger');

/**
 * NeonClipperAgent
 * Autonomous agent leveraging neonclipping:
 * - Scours popular streamers, trending gaming moments, and viral videos
 * - Uses optical flow & audio loudness jump detection to isolate viral highlights
 * - Renders high-retention 9:16 vertical Shorts with ASS neon glow subtitles
 * - Generates multiple clips per run to feed the YouTube publishing queue 24/7
 */
class NeonClipperAgent {
  constructor(database, credentialManager) {
    this.db = database;
    this.credentials = credentialManager;
    this.logger = new Logger('NeonClipperAgent');
    this.pythonScript = path.join(__dirname, '..', 'utils', 'neon-clipper.py');
  }

  async initialize() {
    this.logger.info('Initializing NeonClipperAgent...');
    return true;
  }

  /**
   * Run multi-clip generation cycle.
   * @param {Object} options
   * @param {string} [options.query] Search query or topic
   * @param {string} [options.url] Direct YouTube video URL
   * @param {number} [options.clips=2] Number of clips to extract
   * @param {number} [options.duration=35] Target duration per clip
   * @returns {Promise<Array<Object>>} List of generated clips
   */
  async runMultiClippingCycle(options = {}) {
    const clipsCount = options.clips || 2;
    const duration = options.duration || 35;
    this.logger.info(`Starting NeonClipping multi-clip extraction (target: ${clipsCount} clips)...`);

    return new Promise((resolve, reject) => {
      const args = [
        this.pythonScript,
        '--clips', String(clipsCount),
        '--duration', String(duration),
        '--outdir', path.join(__dirname, '..', 'temp')
      ];

      if (options.url) {
        args.push('--url', options.url);
      }
      if (options.query) {
        args.push('--query', options.query);
      }

      const proc = spawn('python', args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => {
        stdout += d.toString();
      });

      proc.stderr.on('data', (d) => {
        stderr += d.toString();
        const lines = d.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          this.logger.info(`[Engine] ${line}`);
        }
      });

      proc.on('close', async (code) => {
        if (code !== 0) {
          this.logger.error(`Neon clipper exited with code ${code}`);
          let parsedError = null;
          try {
            const parsed = JSON.parse(stdout.trim());
            if (parsed && parsed.error) parsedError = parsed.error;
          } catch (_e) {
            // stdout was not JSON; fall back to stderr below
          }
          return reject(new Error(parsedError ? `Neon clipper error: ${parsedError}` : `Neon clipper failed (code ${code}): ${stderr.slice(-400)}`));
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          if (!parsed.success) {
            return reject(new Error(parsed.error || 'Unknown neon clipping error'));
          }

          const results = [];
          for (const item of (parsed.clips || [])) {
            results.push({
              title: item.title,
              description: item.description,
              tags: JSON.stringify(item.tags || []),
              videoPath: item.video_path,
              videoType: 'short',
              category: 'Gaming',
              sourceUrl: item.source_url,
              creator: item.uploader,
              duration: item.duration,
              score: item.score,
              reason: item.reason,
              createdAt: new Date().toISOString()
            });
            this.logger.success(`✓ Generated Neon Short: "${item.title}" -> ${item.video_path}`);
          }

          resolve(results);
        } catch (e) {
          this.logger.error(`Failed to parse neon clipper output: ${e.message}. Raw: ${stdout}`);
          reject(e);
        }
      });
    });
  }
}

module.exports = { NeonClipperAgent };
