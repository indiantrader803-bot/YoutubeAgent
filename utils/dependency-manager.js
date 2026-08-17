const os = require('os');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function runCmd(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch (err) {
    return null;
  }
}

function detectHardware() {
  const platform = os.platform(); // win32, linux, darwin
  const arch = os.arch(); // x64, arm64
  const cpus = os.cpus();
  const totalRamGb = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(1);

  let gpu = 'None detected';
  let vramGb = 0;
  let cuda = false;

  if (platform === 'win32') {
    const nvidiaSmi = runCmd('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits');
    if (nvidiaSmi) {
      const parts = nvidiaSmi.split(',');
      gpu = parts[0] ? parts[0].trim() : 'NVIDIA GPU';
      if (parts[1]) {
        vramGb = (parseFloat(parts[1].trim()) / 1024).toFixed(1);
      }
      cuda = true;
    } else {
      const wmic = runCmd('wmic path win32_videocard get name,adapterram');
      if (wmic) {
        gpu = wmic.split('\n').map(l => l.trim()).filter(l => l && !l.toLowerCase().includes('name'))[0] || gpu;
      }
    }
  } else if (platform === 'linux') {
    const nvidiaSmi = runCmd('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits');
    if (nvidiaSmi) {
      const parts = nvidiaSmi.split(',');
      gpu = parts[0] ? parts[0].trim() : 'NVIDIA GPU';
      if (parts[1]) {
        vramGb = (parseFloat(parts[1].trim()) / 1024).toFixed(1);
      }
      cuda = true;
    }
  }

  return {
    platform,
    arch,
    cpu: cpus.length ? cpus[0].model : 'Generic CPU',
    cpuCores: cpus.length,
    ramGb: totalRamGb,
    gpu,
    vramGb,
    cuda
  };
}

function checkDependencies() {
  const hardware = detectHardware();

  const nodeVer = runCmd('node --version');
  const npmVer = runCmd('npm --version');
  const pythonVer = runCmd('python --version') || runCmd('python3 --version');
  const ffmpegVer = runCmd('ffmpeg -version');
  const remotionVer = runCmd('npx --no-install remotion --version') || runCmd('node -e "console.log(require(\'remotion/package.json\').version)"');
  const ytdlpVer = runCmd('yt-dlp --version');
  const piperVer = runCmd('piper --version');

  // Check Python environment & packages
  let kokoroOk = false;
  let whisperOk = false;

  if (pythonVer) {
    const pyCheck = runCmd('python -c "import kokoro; print(\'kokoro_ok\')" 2>NUL') ||
                    runCmd('python -c "import kokoro_onnx; print(\'kokoro_ok\')" 2>NUL');
    if (pyCheck && pyCheck.includes('kokoro_ok')) kokoroOk = true;

    const whisperCheck = runCmd('python -c "import whisper; print(\'whisper_ok\')" 2>NUL');
    if (whisperCheck && whisperCheck.includes('whisper_ok')) whisperOk = true;
  }

  // ComfyUI status based on VRAM & availability
  const comfyUrl = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
  let comfyOk = false;
  const comfyCheck = runCmd(`node -e "require('axios').get('${comfyUrl}/system_stats').then(()=>console.log('comfy_ok')).catch(()=>{})"`);
  if (comfyCheck && comfyCheck.includes('comfy_ok')) comfyOk = true;

  // Recommended Whisper model based on VRAM/RAM
  let recommendedWhisperModel = 'tiny';
  const ramNum = parseFloat(hardware.ramGb);
  const vramNum = parseFloat(hardware.vramGb);

  if (vramNum >= 10 || ramNum >= 16) recommendedWhisperModel = 'medium';
  else if (vramNum >= 6 || ramNum >= 8) recommendedWhisperModel = 'small';
  else if (vramNum >= 4 || ramNum >= 4) recommendedWhisperModel = 'base';

  const report = {
    hardware,
    dependencies: {
      node: { installed: !!nodeVer, version: nodeVer },
      npm: { installed: !!npmVer, version: npmVer },
      python: { installed: !!pythonVer, version: pythonVer },
      ffmpeg: { installed: !!ffmpegVer, version: ffmpegVer ? ffmpegVer.split('\n')[0] : null },
      remotion: { installed: !!remotionVer, version: remotionVer },
      kokoro: { installed: kokoroOk, status: kokoroOk ? 'PASS (Local Primary TTS)' : 'MISSING (Will install / Fallback to Piper)' },
      piper: { installed: !!piperVer, version: piperVer, status: piperVer ? 'PASS (Local Fallback TTS)' : 'OPTIONAL / FALLBACK' },
      whisper: { installed: whisperOk, recommendedModel: recommendedWhisperModel, status: whisperOk ? `PASS (${recommendedWhisperModel} model)` : 'MISSING (Will install)' },
      comfyui: { installed: comfyOk, status: comfyOk ? 'PASS (Active)' : (hardware.vramGb >= 6 ? 'AVAILABLE / OPTIONAL' : 'DISABLED (VRAM < 6GB, stock media used)') },
      ytdlp: { installed: !!ytdlpVer, version: ytdlpVer }
    }
  };

  return report;
}

function printDoctorReport(report) {
  const { hardware, dependencies: deps } = report;

  console.log('\n==================================================');
  console.log('       YoutubeAgent Dependency & Doctor Check     ');
  console.log('==================================================\n');

  console.log('💻 Hardware Profile:');
  console.log(`  • OS Platform: ${hardware.platform} (${hardware.arch})`);
  console.log(`  • CPU: ${hardware.cpu} (${hardware.cpuCores} cores)`);
  console.log(`  • RAM: ${hardware.ramGb} GB`);
  console.log(`  • GPU: ${hardware.gpu} ${hardware.vramGb ? `(${hardware.vramGb} GB VRAM)` : ''}`);
  console.log(`  • CUDA: ${hardware.cuda ? 'Available' : 'Unavailable / CPU mode'}\n`);

  console.log('⚙️ Open-Source Components:');
  console.log(`  • Node.js:  ${deps.node.installed ? '✓ ' + deps.node.version : '❌ MISSING'}`);
  console.log(`  • npm:      ${deps.npm.installed ? '✓ ' + deps.npm.version : '❌ MISSING'}`);
  console.log(`  • Python:   ${deps.python.installed ? '✓ ' + deps.python.version : '❌ MISSING'}`);
  console.log(`  • FFmpeg:   ${deps.ffmpeg.installed ? '✓ ' + deps.ffmpeg.version : '❌ MISSING'}`);
  console.log(`  • Remotion: ${deps.remotion.installed ? '✓ ' + deps.remotion.version : '❌ MISSING (run npm install)'}`);
  console.log(`  • Kokoro:   ${deps.kokoro.installed ? '✓ PASS' : '⚠️ ' + deps.kokoro.status}`);
  console.log(`  • Piper:    ${deps.piper.installed ? '✓ PASS' : 'ℹ️ ' + deps.piper.status}`);
  console.log(`  • Whisper:  ${deps.whisper.installed ? '✓ PASS' : '⚠️ ' + deps.whisper.status}`);
  console.log(`  • ComfyUI:  ${deps.comfyui.installed ? '✓ PASS' : 'ℹ️ ' + deps.comfyui.status}`);
  console.log(`  • yt-dlp:   ${deps.ytdlp.installed ? '✓ ' + deps.ytdlp.version : 'ℹ️ OPTIONAL'}\n`);

  console.log('🎯 Recommended Configuration:');
  console.log(`  • Primary TTS:      Kokoro (Local AI)`);
  console.log(`  • Fallback TTS:     Piper`);
  console.log(`  • Speech Timing:    Whisper (${deps.whisper.recommendedModel} model)`);
  console.log(`  • Visual Engine:    ${hardware.vramGb >= 6 ? 'ComfyUI / Stock Media' : 'Pollinations AI / Stock Canvas'}`);
  console.log(`  • Video Composition: Remotion + FFmpeg`);
  console.log('==================================================\n');
}

module.exports = {
  detectHardware,
  checkDependencies,
  printDoctorReport
};

if (require.main === module) {
  const report = checkDependencies();
  printDoctorReport(report);
}
