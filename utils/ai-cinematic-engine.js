const fs = require('fs').promises;
const path = require('path');
const { bundle } = require('@remotion/bundler');
const { renderMedia, selectComposition } = require('@remotion/renderer');
const { Logger } = require('./logger');
const { VideoAssembler } = require('./video-assembler');

// Category → scene kinds + palettes so a space video gets orbiting planets in
// deep space, an AI video gets neon perspective grids, psychology gets velvet
// waves, etc. Kinds rotate INSIDE a video too, so no two scenes look alike.
const CATEGORY_SCENE_SETS = {
  space: {
    kinds: ['orbit', 'stars', 'particles'],
    palettes: [
      { deep: '#020617', mid: '#1e1b4b', glow: '#818cf8', accent: '#38bdf8' },
      { deep: '#0f0524', mid: '#4c1d95', glow: '#c084fc', accent: '#f0abfc' },
      { deep: '#020617', mid: '#0c4a6e', glow: '#7dd3fc', accent: '#e0f2fe' }
    ]
  },
  'future-ai': {
    kinds: ['grid', 'particles', 'stars'],
    palettes: [
      { deep: '#020617', mid: '#082f49', glow: '#22d3ee', accent: '#38bdf8' },
      { deep: '#030712', mid: '#134e4a', glow: '#2dd4bf', accent: '#5eead4' },
      { deep: '#0b0417', mid: '#312e81', glow: '#818cf8', accent: '#a5b4fc' }
    ]
  },
  'dark-psychology': {
    kinds: ['waves', 'particles'],
    palettes: [
      { deep: '#1e1b4b', mid: '#701a75', glow: '#e879f9', accent: '#f0abfc' },
      { deep: '#0f0524', mid: '#4c1d95', glow: '#a78bfa', accent: '#c4b5fd' },
      { deep: '#111827', mid: '#7f1d1d', glow: '#f87171', accent: '#fca5a5' }
    ]
  },
  'history-what-if': {
    kinds: ['city', 'waves', 'particles'],
    palettes: [
      { deep: '#1c1917', mid: '#78350f', glow: '#fbbf24', accent: '#fcd34d' },
      { deep: '#18120b', mid: '#7c2d12', glow: '#fb923c', accent: '#fed7aa' },
      { deep: '#0c0a09', mid: '#44403c', glow: '#d6d3d1', accent: '#fde68a' }
    ]
  },
  survival: {
    kinds: ['waves', 'grid', 'particles'],
    palettes: [
      { deep: '#022c22', mid: '#065f46', glow: '#34d399', accent: '#6ee7b7' },
      { deep: '#020617', mid: '#7f1d1d', glow: '#f87171', accent: '#fca5a5' },
      { deep: '#052e16', mid: '#166534', glow: '#4ade80', accent: '#bbf7d0' }
    ]
  },
  default: {
    kinds: ['particles', 'waves', 'stars'],
    palettes: [
      { deep: '#020617', mid: '#1e1b4b', glow: '#38bdf8', accent: '#818cf8' },
      { deep: '#030712', mid: '#3730a3', glow: '#818cf8', accent: '#c7d2fe' }
    ]
  }
};

function hashString(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

class AICinematicEngine {
  constructor() {
    this.logger = new Logger('AICinematicEngine');
    this.videoAssembler = new VideoAssembler();
  }

  /**
   * Build the scene timeline from script sections. Each section becomes one
   * procedural cinematic scene with its own kind + palette + parallax depth.
   */
  async buildSceneTimeline(script, totalDurationSeconds, _isShort = false) {
    const fps = 30;
    const totalFrames = Math.max(90, Math.round(totalDurationSeconds * fps));
    const rawSections = script?.mainContent?.sections || [
      { title: 'Intro', content: ['A story worth telling starts right now.'] },
      { title: 'Insight', content: ['Here is what most people miss about this.'] },
      { title: 'Outro', content: ['Subscribe for a new story every single day.'] }
    ];

    const categoryId = script?.metadata?.strategy?.categoryId || script?.categoryId || 'default';
    const set = CATEGORY_SCENE_SETS[categoryId] || CATEGORY_SCENE_SETS.default;
    const depth = script?.visualStyle === 'motion-3d' ? 1.0 : 0.6;

    const sceneCount = rawSections.length;
    const framesPerScene = Math.floor(totalFrames / sceneCount);

    const scenes = [];
    let currentFrame = 0;
    const seedBase = hashString((script?.title || 'cinematic') + categoryId);

    for (let i = 0; i < rawSections.length; i++) {
      const sec = rawSections[i];
      const text = Array.isArray(sec.content) ? sec.content.join(' ') : (sec.content || sec.title || '');
      const isLast = i === rawSections.length - 1;
      const durationInFrames = isLast ? (totalFrames - currentFrame) : framesPerScene;

      scenes.push({
        id: i,
        startFrame: currentFrame,
        durationInFrames,
        kind: set.kinds[(i + seedBase) % set.kinds.length],
        palette: set.palettes[(i + seedBase) % set.palettes.length],
        title: sec.title || '',
        text,
        depth,
        seed: seedBase + i * 977
      });

      currentFrame += durationInFrames;
    }

    return { scenes, totalFrames, fps };
  }

  /**
   * Render the procedural AI-cinematic video and mux in the narration audio.
   */
  async renderCinematicVideo(script, audioPath, outputPath, options = {}) {
    this.logger.info('🎬 Starting AI Cinematic render (procedural motion-graphics engine)...');

    const isShort = Boolean(options.isShort || script?.isShort || script?.video_type === 'shorts');
    const width = isShort ? 1080 : 1920;
    const height = isShort ? 1920 : 1080;

    // 1. Probe audio duration
    let audioDuration = await this.videoAssembler.getDuration(audioPath);
    if (!audioDuration || audioDuration < 3) {
      audioDuration = 10;
    }
    this.logger.info(`Narration duration: ${audioDuration.toFixed(1)}s (${isShort ? 'Shorts 9:16' : 'Landscape 16:9'})`);

    // 2. Build timeline
    const { scenes, totalFrames, fps } = await this.buildSceneTimeline(script, audioDuration, isShort);
    const categoryId = script?.metadata?.strategy?.categoryId || script?.categoryId || 'default';
    const kindsUsed = [...new Set(scenes.map((s) => s.kind))].join(', ');
    this.logger.info(`Cinematic scenes: ${scenes.length} [${kindsUsed}] for category "${categoryId}"`);

    // 3. Bundle Remotion Root composition
    const entryPoint = path.resolve(__dirname, '..', 'remotion', 'index.js');
    this.logger.info('Bundling Remotion AI-cinematic composition...');
    const bundleLocation = await bundle({
      entryPoint,
      webpackOverride: (config) => config
    });

    const compositionProps = { scenes, isShort };

    // 4. Select Composition
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: 'AICinematicVideo',
      inputProps: compositionProps
    });

    composition.durationInFrames = totalFrames;
    composition.fps = fps;
    composition.width = width;
    composition.height = height;

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const tempVisualPath = outputPath.replace(/\.mp4$/i, '_visual.mp4');

    // 5. Render visuals via headless Chromium
    let lastReportedPct = -1;
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: 'h264',
      outputLocation: tempVisualPath,
      inputProps: compositionProps,
      concurrency: 2,
      scale: 1,
      imageFormat: 'jpeg',
      pixelFormat: 'yuv420p',
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 100);
        if (pct % 25 === 0 && pct !== lastReportedPct) {
          lastReportedPct = pct;
          this.logger.info(`Render progress: ${pct}%`);
        }
      }
    });

    // 6. Mux narration audio
    this.logger.info('Muxing narration audio with AI-cinematic visuals...');
    await this.videoAssembler.muxAudio(tempVisualPath, audioPath, outputPath);

    await fs.unlink(tempVisualPath).catch(() => {});

    this.logger.info(`🎉 AI Cinematic video successfully generated: ${outputPath}`);
    return outputPath;
  }
}

module.exports = { AICinematicEngine, CATEGORY_SCENE_SETS };
