const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const { Logger } = require('../utils/logger');

/**
 * GTAStreamClipperAgent
 * Autonomous agent that clips popular GTA 6 streamer moments,
 * transforms them into 9:16 vertical Shorts, and schedules/publishes them to YouTube.
 */
class GTAStreamClipperAgent {
  constructor(database, credentialManager) {
    this.db = database;
    this.credentials = credentialManager;
    this.logger = new Logger('GTAStreamClipperAgent');
    this.pythonScript = path.join(__dirname, '..', 'utils', 'gta-clipper.py');
  }

  async initialize() {
    this.logger.info('Initializing GTAStreamClipperAgent...');
    return true;
  }

  /**
   * Run the clipping workflow:
   * 1. Execute gta-clipper.py to find, download, and render a 9:16 Short.
   * 2. Schedule or immediately publish the video through PublishingSchedulingAgent.
   */
  async runClippingCycle(options = {}) {
    this.logger.info('Starting GTA 6 Livestream Clipping Cycle...');
    const duration = options.duration || 35;
    const timestamp = Date.now();
    const outPath = path.join(__dirname, '..', 'temp', `gta6_short_${timestamp}.mp4`);

    return new Promise((resolve, reject) => {
      const args = [this.pythonScript, '--duration', String(duration), '--out', outPath];
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
        // Log Python progress lines
        const lines = d.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          this.logger.info(`[Engine] ${line}`);
        }
      });

      proc.on('close', async (code) => {
        if (code !== 0) {
          this.logger.error(`Python clipper exited with code ${code}`);
          let parsedError = null;
          try {
            const parsed = JSON.parse(stdout.trim());
            if (parsed && parsed.error) parsedError = parsed.error;
          } catch (_e) {
            // stdout was not JSON; fall back to stderr below
          }
          return reject(new Error(parsedError ? `GTA clipper error: ${parsedError}` : `GTA clipper failed (code ${code}): ${stderr.slice(-400)}`));
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          if (!parsed.success) {
            return reject(new Error(parsed.error || 'Unknown clipping error'));
          }

          this.logger.success(`✓ Rendered GTA Short: "${parsed.title}" at ${parsed.video_path}`);
          
          // Register in database or publishing queue
          const contentRecord = {
            title: parsed.title,
            description: parsed.description,
            tags: JSON.stringify(parsed.tags),
            videoPath: parsed.video_path,
            videoType: 'short',
            category: 'Gaming',
            sourceUrl: parsed.source_url,
            creator: parsed.uploader,
            createdAt: new Date().toISOString()
          };

          resolve(contentRecord);
        } catch (e) {
          this.logger.error(`Failed to parse clipper output: ${e.message}. Raw output: ${stdout}`);
          reject(e);
        }
      });
    });
  }
}

module.exports = { GTAStreamClipperAgent };
