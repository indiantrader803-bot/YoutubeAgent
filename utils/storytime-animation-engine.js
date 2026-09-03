const fs = require('fs').promises;
const path = require('path');
const { bundle } = require('@remotion/bundler');
const { renderMedia, selectComposition } = require('@remotion/renderer');
const { Logger } = require('./logger');
const { VideoAssembler } = require('./video-assembler');

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

      // Select background as Base64 Data URI
      const bgName = sec.background || (i % 2 === 0 ? 'classroom' : 'bedroom');
      const bgPath = path.join(bgDir, `${bgName}.png`);
      let bgUrl = null;
      try {
        const bBuf = await fs.readFile(bgPath);
        bgUrl = `data:image/png;base64,${bBuf.toString('base64')}`;
      } catch (e) {
        // fallback
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

    const compositionProps = {
      scenes,
      isShort
    };

    // 4. Select Composition
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: 'StorytimeVideo',
      inputProps: compositionProps
    });

    composition.durationInFrames = totalFrames;
    composition.fps = fps;
    composition.width = width;
    composition.height = height;

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const tempVisualPath = outputPath.replace(/\.mp4$/i, '_visual.mp4');

    // 5. Render Visuals to MP4 via Remotion Headless Chromium
    this.logger.info(`Rendering ${totalFrames} frames @ ${fps}fps (${width}x${height})...`);
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
        if (Math.round(progress * 100) % 25 === 0) {
          this.logger.info(`Render progress: ${Math.round(progress * 100)}%`);
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
