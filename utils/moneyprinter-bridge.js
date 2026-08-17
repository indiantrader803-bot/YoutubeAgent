const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const { Logger } = require('./logger');

class MoneyPrinterBridge {
  constructor() {
    this.logger = new Logger('MoneyPrinterBridge');
    this.vendorDir = path.join(__dirname, '..', 'vendor', 'MoneyPrinterTurbo');
  }

  isAvailable() {
    try {
      require('child_process').execSync('python --version', { stdio: 'ignore' });
      return true;
    } catch (e) {
      return false;
    }
  }

  async generateTurboVideo(topic, isShort = true, outputPath = null) {
    if (!this.isAvailable()) {
      this.logger.warn('Python runtime unavailable for MoneyPrinterTurbo; using native AI generator fallback');
      return null;
    }

    this.logger.info(`⚡ Launching MoneyPrinterTurbo engine for topic: "${topic}"...`);

    const outVideoPath = outputPath || path.join(__dirname, '..', 'data', 'videos', `turbo_${Date.now()}.mp4`);
    const aspect = isShort ? '9:16' : '16:9';

    return new Promise((resolve) => {
      const cliArgs = [
        path.join(this.vendorDir, 'cli.py'),
        '-v', topic,
        '-a', aspect,
        '-o', outVideoPath
      ];

      const pyProcess = spawn('python', cliArgs, {
        cwd: this.vendorDir,
        env: { ...process.env, PYTHONPATH: this.vendorDir }
      });

      let stdOutLogs = '';
      let stdErrLogs = '';

      pyProcess.stdout.on('data', (data) => {
        stdOutLogs += data.toString();
      });

      pyProcess.stderr.on('data', (data) => {
        stdErrLogs += data.toString();
      });

      pyProcess.on('close', async (code) => {
        if (code === 0 && await fs.access(outVideoPath).then(() => true).catch(() => false)) {
          this.logger.success(`MoneyPrinterTurbo video generated successfully: ${outVideoPath}`);
          resolve({ path: outVideoPath, engine: 'MoneyPrinterTurbo' });
        } else {
          this.logger.warn(`MoneyPrinterTurbo process exited with code ${code}. Log output:\n${stdErrLogs || stdOutLogs}`);
          resolve(null);
        }
      });
    });
  }
}

module.exports = { MoneyPrinterBridge };
