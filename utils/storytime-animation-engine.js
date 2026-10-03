const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const { bundle } = require('@remotion/bundler');
const { renderMedia, selectComposition } = require('@remotion/renderer');
const { Logger } = require('./logger');
const { VideoAssembler } = require('./video-assembler');

// Category-themed background generators. A space video gets a starfield, an
// AI video gets a neon grid, psychology gets velvet waves — the classroom PNG
// is now only used for generic/custom topics. Each pack rotates variants so
// scenes inside one video differ too.
const CATEGORY_THEME_PACKS = {
  space: [
    { id: 'deep-space', sky: ['#010409', '#0b1026', '#1e1b4b'], deco: 'stars', accent: '#7dd3fc' },
    { id: 'nebula', sky: ['#0f0524', '#3b0764', '#701a75'], deco: 'stars', accent: '#e879f9' },
    { id: 'dawn-orbit', sky: ['#020617', '#0c4a6e', '#155e75'], deco: 'stars', accent: '#a5f3fc' }
  ],
  'future-ai': [
    { id: 'tech-grid', sky: ['#010409', '#082f49', '#0f172a'], deco: 'grid', accent: '#22d3ee' },
    { id: 'quantum-lab', sky: ['#030712', '#134e4a', '#042f2e'], deco: 'grid', accent: '#2dd4bf' }
  ],
  'dark-psychology': [
    { id: 'mind-velvet', sky: ['#1e1b4b', '#4c1d95', '#831843'], deco: 'waves', accent: '#e879f9' },
    { id: 'shadow-room', sky: ['#111827', '#312e81', '#1e1b4b'], deco: 'waves', accent: '#a78bfa' }
  ],
  'history-what-if': [
    { id: 'ancient-dawn', sky: ['#292524', '#78350f', '#b45309'], deco: 'dunes', accent: '#fcd34d' },
    { id: 'lost-empire', sky: ['#1c1917', '#44403c', '#78716c'], deco: 'dunes', accent: '#fde68a' }
  ],
  survival: [
    { id: 'wild-frontier', sky: ['#022c22', '#065f46', '#064e3b'], deco: 'peaks', accent: '#34d399' },
    { id: 'ember-dusk', sky: ['#1c1917', '#7c2d12', '#9a3412'], deco: 'peaks', accent: '#fb923c' }
  ]
};

function themeBackgroundSvg(theme, width, height) {
  const [c1, c2, c3] = theme.sky;
  let deco = '';
  if (theme.deco === 'stars') {
    // Deterministic starfield + nebula glow blobs
    let stars = '';
    for (let i = 0; i < 90; i++) {
      const x = Math.round(((Math.sin(i * 127.1) * 43758.5453) % 1 + 1) % 1 * width);
      const y = Math.round(((Math.sin(i * 311.7) * 12543.21) % 1 + 1) % 1 * height * 0.9);
      const r = 1 + (((Math.sin(i * 74.7) * 9631.13) % 1 + 1) % 1) * 2.6;
      stars += `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="#ffffff" opacity="${(0.25 + (((Math.sin(i * 91.3) * 71.7) % 1 + 1) % 1) * 0.7).toFixed(2)}"/>`;
    }
    deco = `
      <ellipse cx="${width * 0.72}" cy="${height * 0.3}" rx="${width * 0.34}" ry="${height * 0.2}" fill="${theme.accent}" opacity="0.10"/>
      <ellipse cx="${width * 0.22}" cy="${height * 0.42}" rx="${width * 0.26}" ry="${height * 0.16}" fill="#818cf8" opacity="0.08"/>
      ${stars}`;
  } else if (theme.deco === 'grid') {
    const horizon = height * 0.62;
    let h = '';
    for (let i = 1; i <= 9; i++) {
      const y = horizon + Math.pow(i / 9, 2.1) * (height - horizon);
      h += `<line x1="0" y1="${y.toFixed(0)}" x2="${width}" y2="${y.toFixed(0)}" stroke="${theme.accent}" stroke-width="${(1 + i * 0.22).toFixed(1)}" opacity="0.3"/>`;
    }
    let v = '';
    for (let i = -8; i <= 8; i++) {
      v += `<line x1="${width / 2 + i * width * 0.02}" y1="${horizon}" x2="${width / 2 + i * width * 0.19}" y2="${height}" stroke="${theme.accent}" stroke-width="1.6" opacity="0.25"/>`;
    }
    deco = `
      <rect x="0" y="${horizon - 2}" width="${width}" height="4" fill="${theme.accent}" opacity="0.75"/>
      <rect x="0" y="${horizon - 18}" width="${width}" height="36" fill="${theme.accent}" opacity="0.12"/>
      ${h}${v}`;
  } else if (theme.deco === 'waves') {
    let w = '';
    for (let l = 0; l < 4; l++) {
      const baseY = height * (0.5 + l * 0.12);
      const amp = height * (0.05 + l * 0.015);
      let pts = `0,${height} `;
      for (let x = 0; x <= width; x += 40) {
        const y = baseY + Math.sin(x / 230 + l * 1.4) * amp;
        pts += `${x},${y.toFixed(0)} `;
      }
      pts += `${width},${height}`;
      w += `<polygon points="${pts}" fill="${l % 2 === 0 ? c2 : theme.accent}" opacity="${(0.14 + l * 0.1).toFixed(2)}"/>`;
    }
    deco = w;
  } else if (theme.deco === 'dunes') {
    deco = `
      <circle cx="${width * 0.68}" cy="${height * 0.3}" r="${height * 0.11}" fill="#fde68a" opacity="0.85"/>
      <path d="M0 ${height * 0.72} Q ${width * 0.3} ${height * 0.56} ${width * 0.62} ${height * 0.74} T ${width} ${height * 0.7} V ${height} H 0 Z" fill="#78350f" opacity="0.8"/>
      <path d="M0 ${height * 0.84} Q ${width * 0.42} ${height * 0.7} ${width} ${height * 0.86} V ${height} H 0 Z" fill="#451a03" opacity="0.9"/>`;
  } else if (theme.deco === 'peaks') {
    deco = `
      <polygon points="0,${height} ${width * 0.18},${height * 0.42} ${width * 0.36},${height}" fill="#064e3b" opacity="0.85"/>
      <polygon points="${width * 0.22},${height} ${width * 0.5},${height * 0.3} ${width * 0.82},${height}" fill="#065f46" opacity="0.8"/>
      <polygon points="${width * 0.6},${height} ${width * 0.84},${height * 0.4} ${width},${height}" fill="#022c22" opacity="0.9"/>
      <rect x="0" y="${height * 0.8}" width="${width}" height="${height * 0.2}" fill="${theme.accent}" opacity="0.07"/>`;
  }
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="55%" stop-color="${c2}"/>
        <stop offset="100%" stop-color="${c3}"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#sky)"/>
    ${deco}
  </svg>`;
}

class StorytimeAnimationEngine {
  constructor() {
    this.logger = new Logger('StorytimeAnimationEngine');
    this.videoAssembler = new VideoAssembler();
  }

  /**
   * Automatically infer character pose from scene text
   */
  inferPoseFromText(text = '') {
    const lower = text.toLowerCase();
    if (/gussa|angry|bakwas|chilla|screaming|pagal|mar gaya|fail|tabahi|danger|shout/i.test(lower)) {
      return 'screaming_angry';
    }
    if (/haha|lol|laugh|funny|maza|comedy|hasna|joke|chutkula|gajab/i.test(lower)) {
      return 'laughing';
    }
    if (/shock|dar|scared|police|pakda|caught|arre|omg|surprise|test|bhagwan/i.test(lower)) {
      return 'shocked';
    }
    if (/dekho|listen|point|rule|secret|dhyan|mark|dost/i.test(lower)) {
      return 'pointing';
    }
    if (/cry|roya|sad|dukh|dard|aansu|dardnaak|khatam/i.test(lower)) {
      return 'crying';
    }
    return 'neutral_talk';
  }

  /**
   * Prepare scene timeline and frame allocations
   */
  async buildSceneTimeline(script, totalDurationSeconds, isShort = false) {
    const fps = 30;
    const totalFrames = Math.max(90, Math.round(totalDurationSeconds * fps));
    const rawSections = script?.mainContent?.sections || [
      { title: 'Intro', content: ['School life mein sabse bada suspense surprise test hota hai.'] },
      { title: 'Climax', content: ['Teacher ne jaise hi question paper diya, sabki bolti band!'] },
      { title: 'Outro', content: ['Subscribe karo agar aapke sath bhi aisa hua hai!'] }
    ];

    const assetsDir = path.resolve(__dirname, '..', 'assets');
    const charsDir = path.join(assetsDir, 'characters');
    const bgDir = path.join(assetsDir, 'backgrounds');

    // Category-themed backgrounds (space video ≠ classroom video!)
    const categoryId = script?.metadata?.strategy?.categoryId || script?.categoryId || null;
    const themePack = categoryId ? CATEGORY_THEME_PACKS[categoryId] : null;
    let themeBackgrounds = null;
    if (themePack) {
      const bgWidth = (script?.isShort || script?.video_type === 'shorts') ? 1080 : 1920;
      const bgHeight = (script?.isShort || script?.video_type === 'shorts') ? 1920 : 1080;
      themeBackgrounds = [];
      for (const theme of themePack) {
        try {
          const png = await sharp(Buffer.from(themeBackgroundSvg(theme, bgWidth, bgHeight))).png().toBuffer();
          themeBackgrounds.push({ dataUri: `data:image/png;base64,${png.toString('base64')}`, accent: theme.accent, id: theme.id });
        } catch (e) {
          this.logger.warn(`Theme background "${theme.id}" failed: ${e.message}`);
        }
      }
      if (themeBackgrounds.length > 0) {
        this.logger.info(`Using "${categoryId}" theme backgrounds: ${themeBackgrounds.map((t) => t.id).join(', ')}`);
      } else {
        themeBackgrounds = null;
      }
    }

    const sceneCount = rawSections.length;
    const framesPerScene = Math.floor(totalFrames / sceneCount);

    const scenes = [];
    let currentFrame = 0;

    for (let i = 0; i < rawSections.length; i++) {
      const sec = rawSections[i];
      const text = Array.isArray(sec.content) ? sec.content.join(' ') : (sec.content || sec.title || '');
      const pose = sec.pose || this.inferPoseFromText(text);
      const isLast = i === rawSections.length - 1;
      const durationInFrames = isLast ? (totalFrames - currentFrame) : framesPerScene;

      // Select sprite file as Base64 Data URI
      const spriteFileName = `hero_${pose}.png`;
      const spritePath = path.join(charsDir, spriteFileName);
      let spriteUrl = null;
      try {
        const sBuf = await fs.readFile(spritePath);
        spriteUrl = `data:image/png;base64,${sBuf.toString('base64')}`;
      } catch (e) {
        // fallback
      }

      // Category-themed background first; classic cartoon rooms only for
      // generic/custom topics.
      let bgUrl = null;
      let accent = '#38bdf8';
      if (themeBackgrounds) {
        const themed = themeBackgrounds[i % themeBackgrounds.length];
        bgUrl = themed.dataUri;
        accent = themed.accent;
      } else {
        const legacyRooms = ['classroom', 'bedroom', 'street'];
        const bgName = sec.background || legacyRooms[i % legacyRooms.length];
        const bgPath = path.join(bgDir, `${bgName}.png`);
        try {
          const bBuf = await fs.readFile(bgPath);
          bgUrl = `data:image/png;base64,${bBuf.toString('base64')}`;
        } catch (e) {
          // fallback
        }
      }

      const isPunchline = pose === 'screaming_angry' || pose === 'shocked';
      const zoom = isPunchline ? (isShort ? 1.25 : 1.35) : 1.0;
      const vfx = isPunchline ? 'speed_lines' : 'none';

      scenes.push({
        id: i,
        startFrame: currentFrame,
        durationInFrames,
        speaker: 'hero',
        pose,
        characterImage: spriteUrl,
        bgImage: bgUrl,
        text,
        accent,
        zoom,
        vfx
      });

      currentFrame += durationInFrames;
    }

    return { scenes, totalFrames, fps };
  }

  /**
   * Render complete 2D cartoon video using Remotion
   */
  async renderStorytimeVideo(script, audioPath, outputPath, options = {}) {
    this.logger.info('🎬 Starting 2D Cartoon Storytime Video Render (Not Your Type / Lil Yash Style)...');

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

    // 3. Bundle Remotion Root composition
    const entryPoint = path.resolve(__dirname, '..', 'remotion', 'index.js');
    this.logger.info('Bundling Remotion React composition...');
    const bundleLocation = await bundle({
      entryPoint,
      webpackOverride: (config) => config
    });

    const isTrading = /trading|crypto|forex|stock|candlestick|chart|breakout|pattern|entry/i.test(
      (script?.title || '') + ' ' + (script?.topic || '') + ' ' + (script?.videoStyle || '')
    );
    const compositionId = isTrading ? 'TradingVideo' : 'StorytimeVideo';

    const compositionProps = {
      title: script?.title || 'SECRET ENTRY STRATEGY 🚀',
      strategyType: script?.strategyType || 'Bull Flag Breakout',
      scenes,
      isShort
    };

    // 4. Select Composition
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: compositionId,
      inputProps: compositionProps
    });

    composition.durationInFrames = totalFrames;
    composition.fps = fps;
    composition.width = width;
    composition.height = height;

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const tempVisualPath = outputPath.replace(/\.mp4$/i, '_visual.mp4');

    // 5. Render Visuals to MP4 via Remotion Headless Chromium
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

    // 6. Mux Narration Audio with FFmpeg
    this.logger.info('Muxing narration audio with 2D cartoon video...');
    await this.videoAssembler.muxAudio(tempVisualPath, audioPath, outputPath);

    await fs.unlink(tempVisualPath).catch(() => {});

    this.logger.info(`🎉 2D Cartoon Storytime Video successfully generated: ${outputPath}`);
    return outputPath;
  }
}

module.exports = { StorytimeAnimationEngine };
