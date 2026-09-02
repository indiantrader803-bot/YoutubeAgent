const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const { Logger } = require('./logger');

class VUZABridge {
  constructor() {
    this.logger = new Logger('VUZABridge');
    this.vuzaDir = path.join(__dirname, '..', 'vendor', 'VUZA-Free-AI-Video-Creator');
  }

  isAvailable() {
    return true; // VUZA engine is installed under vendor/
  }

  async generateVUZAVideo(script, isShort, outputPath) {
    this.logger.info(`⚡ Launching VUZA Open-Source Video Engine for: "${script?.title || 'Viral Video'}"...`);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const pythonCmd = process.platform === 'win32' && require('fs').existsSync('.venv/Scripts/python.exe')
      ? '.venv\\Scripts\\python.exe'
      : 'python';

    const scriptJsonPath = path.join(path.dirname(outputPath), `vuza_script_${Date.now()}.json`);
    
    // Format script into VUZA scene chunks
    const sections = script?.mainContent?.sections || [
      { title: 'Introduction', content: ['Welcome to our deep dive story.'] },
      { title: 'Overview', content: ['Discovering the core facts.'] }
    ];

    const chunks = sections.map((s, idx) => ({
      sentence: Array.isArray(s.content) ? s.content.join(' ') : String(s.content || s.title),
      keyword: (s.title || `scene_${idx + 1}`).replace(/[^a-zA-Z0-9]/g, '_')
    }));

    await fs.writeFile(scriptJsonPath, JSON.stringify(chunks, null, 2));

    const runnerScript = `import sys, os, json, asyncio
sys.path.insert(0, r"${this.vuzaDir}")
from video_engine import VideoEngine
try:
    from app import VideoSettings
except Exception:
    class VideoSettings:
        def __init__(self):
            self.ratio = "9:16"
            self.subtitles = True
            self.subtitle_style = "high_retention"
            self.filter = "none"
            self.vibe = "general"
            self.watermark = False

async def main():
    engine = VideoEngine(r"${path.dirname(outputPath).replace(/\\/g, '\\\\')}")
    with open(r"${scriptJsonPath.replace(/\\/g, '\\\\')}", "r", encoding="utf-8") as f:
        script_data = json.load(f)
    
    # Generate speech narration
    for i, item in enumerate(script_data):
        await engine.generate_voiceover(item["sentence"], i, voice="en-US-ChristopherNeural")

    settings = VideoSettings()
    settings.ratio = "9:16" if ${isShort ? 'True' : 'False'} else "16:9"
    settings.subtitles = True

    # Assemble video using MoviePy
    output_video = engine.create_video(script_data, engine.output_dir, media_type="image", settings=settings)
    if output_video and os.path.exists(output_video):
        os.replace(output_video, r"${outputPath.replace(/\\/g, '\\\\')}")
        print("VUZA_SUCCESS")
    else:
        sys.exit(1)

asyncio.run(main())
`;

    const runnerPy = path.join(path.dirname(outputPath), `run_vuza_${Date.now()}.py`);
    await fs.writeFile(runnerPy, runnerScript);

    try {
      const { stdout } = await execAsync(`${pythonCmd} "${runnerPy}"`, { timeout: 120000 });
      await fs.unlink(runnerPy).catch(() => {});
      await fs.unlink(scriptJsonPath).catch(() => {});

      if (stdout.includes('VUZA_SUCCESS')) {
        this.logger.info('🎉 VUZA Engine Video Generation Complete!');
        return { path: outputPath };
      }
    } catch (err) {
      this.logger.warn(`VUZA Engine fallback (${err.message}). Using Playwright HTML Canvas visual renderer.`);
      await fs.unlink(runnerPy).catch(() => {});
      await fs.unlink(scriptJsonPath).catch(() => {});
    }

    return null;
  }
}

module.exports = { VUZABridge };
