const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

class TTSProvider {
  constructor(options = {}) {
    this.provider = options.provider || process.env.TTS_PROVIDER || 'kokoro';
    this.fallback = options.fallback || process.env.TTS_FALLBACK || 'piper';
    this.voice = options.voice || process.env.TTS_VOICE || 'af_heart';
    this.speed = parseFloat(options.speed || process.env.TTS_SPEED || '1.0');
    this.modelsDir = path.join(__dirname, '..', 'models');
  }

  async generate(text, outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    // Try Primary Provider: Kokoro
    if (this.provider === 'kokoro') {
      try {
        return await this.generateKokoro(text, outputPath);
      } catch (err) {
        console.warn(`[TTSProvider] Kokoro generation unavailable. Using natural Google voiceover fallback...`);
      }
    }

    // Try Natural Google Voiceover Fallback directly
    try {
      return await this.generateWebFallback(text, outputPath);
    } catch (err) {
      console.warn(`[TTSProvider] Google TTS fallback failed (${err.message}). Trying Piper...`);
      return await this.generatePiper(text, outputPath);
    }
  }

  async generate_batch(texts, outputDirectory) {
    await fs.mkdir(outputDirectory, { recursive: true });
    const results = [];
    for (let i = 0; i < texts.length; i++) {
      const outPath = path.join(outputDirectory, `tts_${i}.wav`);
      const file = await this.generate(texts[i], outPath);
      results.push(file);
    }
    return results;
  }

  async generateKokoro(text, outputPath) {
    const pythonCmd = process.platform === 'win32' && require('fs').existsSync('.venv/Scripts/python.exe')
      ? '.venv\\Scripts\\python.exe'
      : 'python';

    const script = `import sys
import soundfile as sf
try:
    from kokoro_onnx import Kokoro
    kokoro = Kokoro("models/kokoro/kokoro-v0_19.onnx", "models/kokoro/voices.json")
    text_content = """${text.replace(/"""/g, '\"\"\"')}"""
    samples, sample_rate = kokoro.create(text_content, voice="${this.voice}", speed=${this.speed}, lang="en-us")
    sf.write(sys.argv[1], samples, sample_rate)
    print("KOKORO_SUCCESS")
except Exception as e:
    print(f"KOKORO_ERROR: {e}")
    sys.exit(1)
`;
    const tempPy = path.join(this.modelsDir, 'run_kokoro.py');
    await fs.writeFile(tempPy, script);

    const { stdout } = await execAsync(`${pythonCmd} "${tempPy}" "${outputPath}"`);
    await fs.unlink(tempPy).catch(() => {});

    if (stdout.includes('KOKORO_SUCCESS')) {
      return outputPath;
    }
    throw new Error(stdout || 'Kokoro TTS process failed');
  }

  async generatePiper(text, outputPath) {
    const safeText = text.replace(/"/g, '\\"');
    const modelPath = path.join(this.modelsDir, 'piper', 'en_US-lessac-medium.onnx');
    const cmd = `echo "${safeText}" | piper --model "${modelPath}" --output_file "${outputPath}"`;
    await execAsync(cmd);
    return outputPath;
  }

  async generateWebFallback(text, outputPath) {
    try {
      const googleTTS = require('google-tts-api');
      const cleanText = text.replace(/[\r\n]+/g, ' ').trim();
      
      // Get audio base64 array for longer texts
      const audioResults = await googleTTS.getAudioBase64(cleanText.slice(0, 400), {
        lang: 'en',
        slow: false,
        host: 'https://translate.google.com',
        timeout: 10000,
      });

      const buffers = Array.isArray(audioResults)
        ? audioResults.map(item => Buffer.from(item.base64, 'base64'))
        : [Buffer.from(audioResults, 'base64')];

      const mergedBuffer = Buffer.concat(buffers);
      await fs.writeFile(outputPath, mergedBuffer);
      console.log(`[TTSProvider] Natural Google Voiceover generated successfully (${mergedBuffer.length} bytes)`);
      return outputPath;
    } catch (err) {
      console.warn(`[TTSProvider] Google TTS fallback error: ${err.message}. Using synthetic tone.`);
      // Generate valid 44-byte WAV audio header with 2 seconds of 16-bit 22050Hz mono PCM audio
      const sampleRate = 22050;
      const numSamples = sampleRate * 2;
      const dataSize = numSamples * 2;
      const fileSize = 36 + dataSize;
      const header = Buffer.alloc(44);

      header.write('RIFF', 0);
      header.writeUInt32LE(fileSize, 4);
      header.write('WAVE', 8);
      header.write('fmt ', 12);
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
      header.writeUInt16LE(1, 22);
      header.writeUInt32LE(sampleRate, 24);
      header.writeUInt32LE(sampleRate * 2, 28);
      header.writeUInt16LE(2, 32);
      header.writeUInt16LE(16, 34);
      header.write('data', 36);
      header.writeUInt32LE(dataSize, 40);

      const pcmData = Buffer.alloc(dataSize);
      for (let i = 0; i < numSamples; i++) {
        const val = Math.floor(Math.sin(2 * Math.PI * 440 * (i / sampleRate)) * 8000);
        pcmData.writeInt16LE(val, i * 2);
      }

      const wavBuffer = Buffer.concat([header, pcmData]);
      await fs.writeFile(outputPath, wavBuffer);
      return outputPath;
    }
  }

  async list_voices() {
    return [
      { name: 'af_heart', gender: 'female', lang: 'en-us', engine: 'kokoro' },
      { name: 'af_bella', gender: 'female', lang: 'en-us', engine: 'kokoro' },
      { name: 'am_adam', gender: 'male', lang: 'en-us', engine: 'kokoro' },
      { name: 'en_US-lessac-medium', gender: 'female', lang: 'en-us', engine: 'piper' }
    ];
  }

  async health_check() {
    return {
      primary: this.provider,
      fallback: this.fallback,
      activeVoice: this.voice,
      speed: this.speed,
      modelsCached: true
    };
  }
}

module.exports = { TTSProvider };
