const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');

class YtdlpProvider {
  constructor(options = {}) {
    this.ytdlpPath = options.ytdlpPath || process.env.YTDLP_PATH || 'yt-dlp';
    this.logFile = path.join(__dirname, '..', 'data', 'attribution_log.json');
  }

  async downloadPermittedMedia(url, outputPath, licenseInfo = {}) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const cmd = `"${this.ytdlpPath}" "${url}" -o "${outputPath}" --format "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"`;
    await execAsync(cmd);

    // Record source URL & attribution logging
    const logEntry = {
      timestamp: new Date().toISOString(),
      sourceUrl: url,
      outputPath,
      license: licenseInfo.license || 'User Permitted / Public Domain',
      author: licenseInfo.author || 'Unknown'
    };

    await this.appendLog(logEntry);
    return outputPath;
  }

  async appendLog(entry) {
    let logs = [];
    try {
      const data = await fs.readFile(this.logFile, 'utf8');
      logs = JSON.parse(data);
    } catch (e) {
      logs = [];
    }
    logs.push(entry);
    await fs.mkdir(path.dirname(this.logFile), { recursive: true });
    await fs.writeFile(this.logFile, JSON.stringify(logs, null, 2));
  }
}

module.exports = { YtdlpProvider };
