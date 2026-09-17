const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs').promises;
const { Logger } = require('./logger');

const execFileAsync = promisify(execFile);

class OpenMontageBridge {
  constructor() {
    this.logger = new Logger('OpenMontageBridge');
    this.openMontageDir = path.resolve(__dirname, '..', 'vendor', 'OpenMontage');
    this.pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    this.composerDir = path.join(this.openMontageDir, 'remotion-composer');
    this.pipelineDefsDir = path.join(this.openMontageDir, 'pipeline_defs');
  }

  async isReady() {
    try {
      const exists = await fs.stat(this.openMontageDir).then(s => s.isDirectory()).catch(() => false);
      return exists;
    } catch {
      return false;
    }
  }

  async listPipelines() {
    try {
      const files = await fs.readdir(this.pipelineDefsDir);
      return files
        .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
        .map(f => f.replace(/\.ya?ml$/i, ''));
    } catch (e) {
      this.logger.warn(`Could not list pipeline definitions: ${e.message}`);
      return [];
    }
  }

  async listDemos() {
    const demoPropsDir = path.join(this.composerDir, 'public', 'demo-props');
    try {
      const files = await fs.readdir(demoPropsDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace(/\.json$/i, ''));
    } catch (e) {
      this.logger.warn(`Could not list demo props: ${e.message}`);
      return ['code-to-screen', 'focusflow-pitch', 'world-in-numbers'];
    }
  }

  async renderDemo(demoName = 'world-in-numbers', outputPath) {
    const scriptPath = path.join(this.openMontageDir, 'render_demo.py');
    const targetOut = outputPath || path.join(__dirname, '..', 'data', 'videos', `openmontage_${demoName}_${Date.now()}.mp4`);
    await fs.mkdir(path.dirname(targetOut), { recursive: true });

    this.logger.info(`Rendering OpenMontage demo composition: ${demoName}...`);

    return new Promise((resolve, reject) => {
      const proc = spawn(this.pythonCmd, [scriptPath, '--demo', demoName], {
        cwd: this.openMontageDir,
        env: { ...process.env }
      });

      proc.stdout.on('data', data => {
        const text = data.toString().trim();
        if (text) this.logger.info(`[OpenMontage] ${text}`);
      });

      proc.stderr.on('data', data => {
        const text = data.toString().trim();
        if (text) this.logger.warn(`[OpenMontage] ${text}`);
      });

      proc.on('close', async code => {
        if (code === 0) {
          const defaultRenderPath = path.join(this.openMontageDir, 'projects', 'demos', 'renders', `${demoName}.mp4`);
          const exists = await fs.stat(defaultRenderPath).then(s => s.size > 0).catch(() => false);
          if (exists) {
            await fs.copyFile(defaultRenderPath, targetOut);
            this.logger.success(`OpenMontage demo rendered successfully to ${targetOut}`);
            resolve(targetOut);
          } else {
            resolve(defaultRenderPath);
          }
        } else {
          reject(new Error(`OpenMontage render_demo exited with code ${code}`));
        }
      });
    });
  }
}

module.exports = { OpenMontageBridge };
