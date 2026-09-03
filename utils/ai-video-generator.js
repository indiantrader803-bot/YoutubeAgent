const OpenAI = require('openai');
const Replicate = require('replicate');
const fs = require('fs').promises;
const path = require('path');
const { pathToFileURL } = require('url');
const axios = require('axios');
const { Logger } = require('./logger');
const { runFFmpeg, checkFFmpeg, ffmpegInstallHint } = require('./ffmpeg');

class AIVideoGenerator {
  constructor(credentials) {
    this.logger = new Logger('AIVideoGenerator');
    
    // Initialize AI services with graceful fallback
    const openaiKey = credentials.openai?.apiKey || process.env.OPENAI_API_KEY;
    const replicateKey = credentials.replicate?.apiKey || process.env.REPLICATE_API_KEY;
    
    if (openaiKey) {
      this.openai = new OpenAI({ apiKey: openaiKey });
      this.logger.info('OpenAI service initialized');
    } else {
      this.logger.warn('OpenAI API key not found - AI features will be simulated');
    }
    
    if (replicateKey) {
      this.replicate = new Replicate({ auth: replicateKey });
      this.logger.info('Replicate service initialized');
    } else {
      this.logger.warn('Replicate API key not found - advanced video generation unavailable');
    }

    // Gemini media generation (images + native TTS) — free-tier alternative to OpenAI
    const geminiKey = credentials.gemini?.apiKey || process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const { GoogleGenAI } = require('@google/genai');
        this.gemini = new GoogleGenAI({ apiKey: geminiKey });
        this.logger.info('Gemini media service initialized (images + TTS)');
      } catch (error) {
        this.logger.warn('Failed to initialize Gemini media service:', error.message);
      }
    }
    
    // ElevenLabs configuration
    this.elevenLabsApiKey = credentials.elevenLabs?.apiKey || credentials.elevenlabs?.apiKey || process.env.ELEVENLABS_API_KEY;
    this.elevenLabsVoiceId = credentials.elevenLabs?.voiceId || credentials.elevenlabs?.voiceId || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
    
    // Json2Video API configuration
    this.json2videoApiKey = credentials.json2video?.apiKey || process.env.JSON2VIDEO_API_KEY;

    // Azure Speech configuration
    this.azureSpeechKey = credentials.azure?.speechKey || process.env.AZURE_SPEECH_REGION;
    this.azureSpeechRegion = credentials.azure?.speechRegion || process.env.AZURE_SPEECH_REGION;

    // Open-Source Providers (Kokoro, Piper, Whisper, ComfyUI)
    const { TTSProvider } = require('./tts-provider');
    const { SubtitleProvider } = require('./subtitle-provider');
    const { ImageProvider } = require('./image-provider');
    const { PexelsVideoProvider } = require('./pexels-video-provider');
    const { VideoAssembler } = require('./video-assembler');
    const { StorytimeAnimationEngine } = require('./storytime-animation-engine');

    this.ttsProvider = new TTSProvider();
    this.subtitleProvider = new SubtitleProvider();
    this.imageProvider = new ImageProvider();
    this.pexelsVideoProvider = new PexelsVideoProvider(credentials.pexels?.apiKey || process.env.PEXELS_API_KEY);
    this.videoAssembler = new VideoAssembler();
    this.storytimeEngine = new StorytimeAnimationEngine();
  }

  async generateTTSAudio(text, outputPath) {
    this.logger.info('Generating TTS audio...');
    
    // 1. ElevenLabs (Professional Studio Voiceover)
    if (this.elevenLabsApiKey && this.elevenLabsVoiceId) {
      try {
        this.logger.info('Using ElevenLabs TTS for studio quality narration...');
        return await this.generateElevenLabsTTS(text, outputPath);
      } catch (err) {
        this.logger.warn(`ElevenLabs TTS failed, trying fallbacks: ${err.message}`);
      }
    }

    // 2. OpenAI TTS
    if (this.openai) {
      try {
        this.logger.info('Using OpenAI TTS fallback...');
        return await this.generateOpenAITTS(text, outputPath);
      } catch (err) {
        this.logger.warn(`OpenAI TTS fallback failed: ${err.message}`);
      }
    }

    // 3. Gemini native TTS (free tier)
    if (this.gemini) {
      try {
        this.logger.info('Using Gemini TTS fallback...');
        return await this.generateGeminiTTS(text, outputPath);
      } catch (err) {
        this.logger.warn(`Gemini TTS fallback failed: ${err.message}`);
      }
    }

    // 4. Open-source local TTS (Kokoro / Piper)
    try {
      this.logger.info('Using local TTS provider fallback...');
      return await this.ttsProvider.generate(text, outputPath);
    } catch (err) {
      this.logger.warn(`Local TTS Provider fallback triggered: ${err.message}`);
    }

    // Final fallback to simulation
    return await this.simulateTTSGeneration(text, outputPath);
  }

  async generateElevenLabsTTS(text, outputPath) {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.elevenLabsVoiceId}`;
    
    const data = {
      text: text,
      model_id: "eleven_v3",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8,
        style: 0.0,
        use_speaker_boost: true
      }
    };

    const response = await axios({
      method: 'POST',
      url: url,
      data: data,
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': this.elevenLabsApiKey
      },
      responseType: 'stream'
    });

    const writer = require('fs').createWriteStream(outputPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        this.logger.info('ElevenLabs TTS generation complete');
        resolve(outputPath);
      });
      writer.on('error', reject);
    });
  }

  async generateOpenAITTS(text, outputPath) {
    const response = await this.openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "coral",
      input: text,
      speed: 1.0
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(outputPath, buffer);

    this.logger.info('OpenAI TTS generation complete');
    return outputPath;
  }

  async generateGeminiTTS(text, outputPath) {
    const model = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
    const voiceName = process.env.GEMINI_TTS_VOICE || 'Kore';

    const response = await this.gemini.models.generateContent({
      model,
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName }
          }
        }
      }
    });

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioData) {
      throw new Error('Gemini TTS returned no audio data');
    }

    // Gemini returns raw PCM (24kHz, mono, 16-bit); encode to the requested container via FFmpeg
    const pcmPath = outputPath + '.pcm';
    await fs.writeFile(pcmPath, Buffer.from(audioData, 'base64'));
    await runFFmpeg(['-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcmPath, outputPath]);
    await fs.unlink(pcmPath).catch(() => {});

    this.logger.info('Gemini TTS generation complete');
    return outputPath;
  }

  async generateVisualAssets(prompt, style = "ethereal", count = 1) {
    this.logger.info(`Generating ${count} visual assets with style: ${style}`);

    try {
      const enhancedPrompt = this.enhanceVisualPrompt(prompt, style);
      const localPaths = [];

      for (let i = 0; i < count; i++) {
        const imagePath = path.join(__dirname, '..', 'data', 'assets', `visual_${Date.now()}_${i}.png`);
        await this.generateImage(enhancedPrompt, imagePath);
        localPaths.push(imagePath);
      }

      this.logger.info(`Generated ${localPaths.length} visual assets`);
      return localPaths;
    } catch (error) {
      this.logger.error('Visual asset generation failed, generating fallback image:', error.message);
      const fallbackPath = path.join(__dirname, '..', 'data', 'assets', `visual_fallback_${Date.now()}.png`);
      try {
        await this.imageProvider.generate(prompt, fallbackPath);
        return [fallbackPath];
      } catch (e) {
        this.logger.warn(`Fallback image generation failed: ${e.message}`);
        return await this.simulateVisualAssets(prompt, style, count);
      }
    }
  }

  async generateImage(prompt, imagePath) {
    await fs.mkdir(path.dirname(imagePath), { recursive: true });

    // 1. Try OpenAI
    if (this.openai) {
      try {
        return await this.generateOpenAIImage(prompt, imagePath);
      } catch (err) {
        this.logger.warn('OpenAI image generation failed, trying fallback:', err.message);
      }
    }

    // 2. Try Gemini
    if (this.gemini) {
      try {
        return await this.generateGeminiImage(prompt, imagePath);
      } catch (err) {
        this.logger.warn('Gemini image generation failed, trying fallback:', err.message);
      }
    }

    // 3. Try ImageProvider (Pollinations AI / ComfyUI)
    try {
      this.logger.info(`Fetching AI visual scene for prompt: ${prompt.slice(0, 30)}...`);
      await this.imageProvider.generate(prompt, imagePath);
      return imagePath;
    } catch (err) {
      this.logger.warn('ImageProvider failed, using visual canvas fallback:', err.message);
    }

    // High-contrast SVG banner rendering fallback
    const titleText = prompt.slice(0, 45).replace(/'/g, "&apos;");
    const svg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="50%" stop-color="#1e1b4b"/>
          <stop offset="100%" stop-color="#311042"/>
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#g)"/>
      <circle cx="640" cy="360" r="280" fill="#8b5cf6" opacity="0.15"/>
      <text x="640" y="340" font-family="Arial, sans-serif" font-size="44" font-weight="bold" fill="#ffffff" text-anchor="middle">${titleText}</text>
      <text x="640" y="410" font-family="Arial, sans-serif" font-size="24" fill="#38bdf8" text-anchor="middle">YouTube AI Autonomous Channel</text>
    </svg>`;

    try {
      const sharp = require('sharp');
      await sharp(Buffer.from(svg)).png().toFile(imagePath);
      return imagePath;
    } catch (e) {
      await fs.writeFile(imagePath, Buffer.from(svg));
      return imagePath;
    }
  }

  async generateOpenAIImage(prompt, imagePath) {
    const response = await this.openai.images.generate({
      model: "dall-e-3",
      prompt: prompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",
    });

    if (response.data[0].b64_json) {
      const buffer = Buffer.from(response.data[0].b64_json, 'base64');
      await fs.writeFile(imagePath, buffer);
    } else {
      await this.downloadImage(response.data[0].url, imagePath);
    }

    return imagePath;
  }

  async generateGeminiImage(prompt, imagePath) {
    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';

    const response = await this.gemini.models.generateContent({
      model,
      contents: prompt
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(part => part.inlineData?.data);
    if (!imagePart) {
      throw new Error('Gemini image generation returned no image data');
    }

    await fs.writeFile(imagePath, Buffer.from(imagePart.inlineData.data, 'base64'));
    return imagePath;
  }

  enhanceVisualPrompt(prompt, style) {
    const styleEnhancements = {
      ethereal: "ethereal, dreamy, mystical, soft lighting, floating particles, cosmic background",
      modern: "modern, clean, minimalist, professional, sleek design, contemporary",
      animated: "animated style, cartoon, vibrant colors, expressive, dynamic",
      cinematic: "cinematic lighting, dramatic, movie poster style, high contrast",
      abstract: "abstract art, geometric shapes, gradient colors, artistic composition"
    };

    const enhancement = styleEnhancements[style] || styleEnhancements.ethereal;
    return `${prompt}, ${enhancement}, high quality, 16:9 aspect ratio, digital art`;
  }

  async downloadImage(url, outputPath) {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    await fs.writeFile(outputPath, Buffer.from(response.data));
    return outputPath;
  }

  async generateVideo(script, visualAssets, audioPath, outputPath) {
    const isShort = Boolean(script?.isShort || script?.video_type === 'shorts');
    const isStorytime = script?.videoStyle === 'storytime' || script?.style === 'cartoon' || process.env.VIDEO_MODE !== 'stock';

    // 1. Try 2D Cartoon Storytime Animation Engine (Not Your Type / Lil Yash Style)
    if (isStorytime && this.storytimeEngine) {
      try {
        this.logger.info('🚀 Launching 2D Cartoon Storytime Studio (Not Your Type / Lil Yash Animation Engine)...');
        return await this.storytimeEngine.renderStorytimeVideo(script, audioPath, outputPath, { isShort });
      } catch (storyErr) {
        this.logger.warn(`Storytime animation engine fallback (${storyErr.message}). Using Pexels stock video assembler...`);
      }
    }

    this.logger.info('Generating dynamic video with real stock footage and AI visual scenes...');

    const tempDir = path.join(path.dirname(outputPath), `temp_render_${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const isShort = Boolean(script?.isShort || script?.video_type === 'shorts');
      const title = script?.title || 'Featured Story';
      const sections = script?.mainContent?.sections || [
        { title: 'Introduction', content: ['Welcome to our deep dive story today.'] },
        { title: 'Key Insights', content: ['Unlocking the mystery step by step.'] },
        { title: 'Conclusion & Next Steps', content: ['Subscribe for daily viral updates.'] }
      ];

      // 1. Calculate total duration from audio file or estimate from script
      let totalDuration = await this.videoAssembler.getDuration(audioPath);
      if (!totalDuration || totalDuration < 5) {
        totalDuration = this.calculateScriptDuration(script) || (sections.length * 8);
      }
      this.logger.info(`Target video duration: ${totalDuration.toFixed(1)}s for ${sections.length} sections`);

      // Allocate duration per section
      const minPerSection = 4;
      const baseSectionDuration = Math.max(minPerSection, totalDuration / sections.length);

      const segmentClips = [];

      for (let i = 0; i < sections.length; i++) {
        const sec = sections[i];
        const secTitle = sec.title || `Part ${i + 1}`;
        const secSubtitle = Array.isArray(sec.content) ? sec.content[0] : (typeof sec.content === 'string' ? sec.content : '');
        const secDuration = sec.duration ? Math.min(sec.duration, baseSectionDuration * 1.5) : baseSectionDuration;

        let mediaSourcePath = null;

        // Step A: Attempt to fetch real HD stock video footage from Pexels
        if (this.pexelsVideoProvider.isConfigured()) {
          try {
            const pexelsResult = await this.pexelsVideoProvider.fetchVideoForSection(sec, i, tempDir, {
              topic: title,
              isShort
            });
            if (pexelsResult && pexelsResult.clipPath) {
              mediaSourcePath = pexelsResult.clipPath;
            }
          } catch (pErr) {
            this.logger.warn(`Pexels fetch failed for section ${i + 1}: ${pErr.message}`);
          }
        }

        // Step B: If no stock video clip, use visualAssets if available or generate AI image
        if (!mediaSourcePath) {
          if (visualAssets && visualAssets[i] && await fs.stat(visualAssets[i]).then(() => true).catch(() => false)) {
            mediaSourcePath = visualAssets[i];
          } else {
            const visualPrompt = `${secTitle}, ${secSubtitle}, cinematic 4k wallpaper, photorealistic detailed atmospheric`;
            const sceneImgPath = path.join(tempDir, `ai_scene_${i}.jpg`);
            try {
              await this.imageProvider.generate(visualPrompt, sceneImgPath);
              mediaSourcePath = sceneImgPath;
            } catch (imgErr) {
              this.logger.warn(`Image generation failed for section ${i + 1}: ${imgErr.message}`);
            }
          }
        }

        // Step C: Fallback to solid graphic if still nothing
        if (!mediaSourcePath) {
          const fallbackImg = path.join(tempDir, `fallback_${i}.png`);
          const sharp = require('sharp');
          const fallbackW = isShort ? 1080 : 1920;
          const fallbackH = isShort ? 1920 : 1080;
          const bgSvg = `<svg width="${fallbackW}" height="${fallbackH}"><rect width="${fallbackW}" height="${fallbackH}" fill="#0f172a"/></svg>`;
          await sharp(Buffer.from(bgSvg)).png().toFile(fallbackImg);
          mediaSourcePath = fallbackImg;
        }

        // Step D: Create sleek modern glassmorphism lower-third overlay banner
        const overlayPath = path.join(tempDir, `overlay_${i}.png`);
        await this.videoAssembler.createLowerThirdOverlay({
          title: secTitle,
          subtitle: secSubtitle,
          badge: `SECTION 0${i + 1} • INSIGHT`,
          isShort
        }, overlayPath);

        // Step E: Normalize this segment (scale to 1080p, trim/loop, burn overlay)
        const segmentOutPath = path.join(tempDir, `segment_${String(i).padStart(2, '0')}.mp4`);
        this.logger.info(`Rendering segment ${i + 1}/${sections.length} (${secDuration.toFixed(1)}s)...`);
        await this.videoAssembler.normalizeSegment(mediaSourcePath, secDuration, segmentOutPath, {
          overlayPath,
          isShort
        });

        segmentClips.push({
          path: segmentOutPath,
          duration: secDuration
        });
      }

      // Step F: Concatenate segments with smooth crossfade
      this.logger.info(`Concatenating ${segmentClips.length} segments with cinematic transitions...`);
      const concatenatedVideoPath = path.join(tempDir, 'concatenated.mp4');
      await this.videoAssembler.concatenateSegments(segmentClips, concatenatedVideoPath);

      // Step G: Mux with narration audio track
      this.logger.info('Muxing narration audio with final video...');
      await this.videoAssembler.muxAudio(concatenatedVideoPath, audioPath, outputPath);

      this.logger.info(`Video successfully produced: ${outputPath}`);
      return outputPath;
    } catch (error) {
      this.logger.error('Video generation failed:', error);
      return await this.simulateVideoGeneration(script, visualAssets, audioPath, outputPath);
    } finally {
      await this.cleanupDirectory(tempDir).catch(() => {});
    }
  }

  async generateReplicateVideo(script, visualAssets, audioPath, outputPath) {
    const output = await this.replicate.run(
      "wan-video/wan-2.7-i2v",
      {
        input: {
          image: visualAssets[0],
          prompt: script.title || "smooth cinematic motion",
          duration: 5,
          resolution: "720p"
        }
      }
    );

    // Download the generated video
    if (output && output.length > 0) {
      await this.downloadVideo(output[0], outputPath);
      
      // Add audio track
      await this.addAudioToVideo(outputPath, audioPath, outputPath);
    }

    return outputPath;
  }

  async generateSlideshowVideo(script, visualAssets, audioPath, outputPath) {
    this.logger.info('Creating slideshow video...');

    if (!(await checkFFmpeg())) {
      throw new Error(ffmpegInstallHint());
    }

    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const slidesDir = path.join(path.dirname(outputPath), 'slides');

    try {
      const page = await browser.newPage();
      await page.setViewportSize({ width: 1920, height: 1080 });

      // Create HTML for slideshow (only real image files can be embedded)
      const imageAssets = await this.filterImageAssets(visualAssets);
      await page.setContent(this.createSlideshowHTML(script, imageAssets));

      // Freeze CSS transitions/animations so each still is captured fully rendered
      await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' });
      await page.waitForTimeout(1000); // Wait for assets to load

      // Capture ONE still per slide instead of screenshotting at 30fps —
      // FFmpeg turns the stills into a crossfaded video in seconds.
      const slideCount = await page.evaluate(() => document.querySelectorAll('.slide').length);
      await fs.mkdir(slidesDir, { recursive: true });

      const stills = [];
      for (let i = 0; i < slideCount; i++) {
        await page.evaluate((index) => {
          document.querySelectorAll('.slide').forEach((slide, s) => {
            slide.classList.toggle('active', s === index);
          });
        }, i);

        const stillPath = path.join(slidesDir, `slide_${String(i).padStart(3, '0')}.png`);
        await page.screenshot({ path: stillPath });
        stills.push(stillPath);
      }

      const videoPath = outputPath.replace('.mp4', '_visual.mp4');
      const duration = this.calculateScriptDuration(script);
      await this.renderSlidesToVideo(stills, duration, videoPath);

      // Add audio
      await this.addAudioToVideo(videoPath, audioPath, outputPath);

      return outputPath;
    } finally {
      await browser.close().catch(() => {});
      await this.cleanupDirectory(slidesDir);
    }
  }

  async renderSlidesToVideo(stills, totalDuration, videoPath) {
    if (stills.length === 0) {
      throw new Error('No slides to render');
    }

    const fade = 0.5;
    const perSlide = Math.max(2, totalDuration / stills.length);

    const args = ['-y'];
    for (const still of stills) {
      args.push('-loop', '1', '-t', perSlide.toFixed(2), '-framerate', '30', '-i', still);
    }

    if (stills.length === 1) {
      args.push('-vf', 'format=yuv420p', '-c:v', 'libx264', videoPath);
      await runFFmpeg(args);
      return videoPath;
    }

    // Chain crossfades: transition k starts fade seconds before slide k ends
    const filters = [];
    let prev = '[0:v]';
    for (let i = 1; i < stills.length; i++) {
      const out = `[v${i}]`;
      const offset = (i * (perSlide - fade)).toFixed(2);
      filters.push(`${prev}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${offset}${out}`);
      prev = out;
    }
    filters.push(`${prev}format=yuv420p[vfinal]`);

    args.push(
      '-filter_complex', filters.join(';'),
      '-map', '[vfinal]',
      '-c:v', 'libx264',
      '-r', '30',
      videoPath
    );

    await runFFmpeg(args);
    return videoPath;
  }

  async filterImageAssets(visualAssets = []) {
    const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
    const images = [];

    for (const asset of visualAssets) {
      if (typeof asset !== 'string' || !imageExtensions.has(path.extname(asset).toLowerCase())) {
        continue;
      }

      try {
        await fs.access(asset);
        images.push(pathToFileURL(asset).href);
      } catch (error) {
        // Skip missing files
      }
    }

    return images;
  }

  createSlideshowHTML(script, visualAssets) {
    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            margin: 0;
            padding: 0;
            width: 1920px;
            height: 1080px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            font-family: 'Arial', sans-serif;
            overflow: hidden;
        }
        
        .slide {
            position: absolute;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 2s ease-in-out;
        }
        
        .slide.active {
            opacity: 1;
        }
        
        .content {
            text-align: center;
            color: white;
            max-width: 80%;
        }
        
        h1 {
            font-size: 72px;
            margin-bottom: 30px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
        }
        
        h2 {
            font-size: 48px;
            margin-bottom: 20px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
        }
        
        p {
            font-size: 36px;
            line-height: 1.4;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
        }
        
        .background-image {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            opacity: 0.3;
            z-index: -1;
        }
        
        .particles {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            z-index: -1;
        }
        
        .particle {
            position: absolute;
            background: rgba(255,255,255,0.8);
            border-radius: 50%;
            animation: float 6s ease-in-out infinite;
        }
        
        @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-20px); }
        }
    </style>
</head>
<body>
    <div class="particles"></div>
    
    <!-- Title Slide -->
    <div class="slide active">
        ${visualAssets[0] ? `<img class="background-image" src="${visualAssets[0]}" />` : ''}
        <div class="content">
            <h1>${script.title}</h1>
            <p>Ethereal Dreamscript</p>
        </div>
    </div>
    
    ${this.generateContentSlides(script, visualAssets).join('')}
    
    <!-- Subscribe Slide -->
    <div class="slide">
        <div class="content">
            <h2>✨ Subscribe for More Stories ✨</h2>
            <p>New content daily at 2:00 PM</p>
        </div>
    </div>
    
    <script>
        // Create floating particles
        function createParticles() {
            const container = document.querySelector('.particles');
            for (let i = 0; i < 20; i++) {
                const particle = document.createElement('div');
                particle.className = 'particle';
                particle.style.left = Math.random() * 100 + '%';
                particle.style.top = Math.random() * 100 + '%';
                particle.style.width = (Math.random() * 4 + 2) + 'px';
                particle.style.height = particle.style.width;
                particle.style.animationDelay = Math.random() * 6 + 's';
                container.appendChild(particle);
            }
        }
        
        let currentSlide = 0;
        const slides = document.querySelectorAll('.slide');
        
        function advanceAnimation() {
            slides[currentSlide].classList.remove('active');
            currentSlide = (currentSlide + 1) % slides.length;
            slides[currentSlide].classList.add('active');
        }
        
        window.advanceAnimation = advanceAnimation;
        createParticles();
    </script>
</body>
</html>`;
  }

  generateContentSlides(script, visualAssets) {
    const slides = [];
    
    if (script.mainContent && script.mainContent.sections) {
      script.mainContent.sections.forEach((section, index) => {
        const assetIndex = Math.min(index + 1, visualAssets.length - 1);
        
        slides.push(`
        <div class="slide">
            ${visualAssets[assetIndex] ? `<img class="background-image" src="${visualAssets[assetIndex]}" />` : ''}
            <div class="content">
                <h2>${section.title}</h2>
                ${this.formatSectionContent(section)}
            </div>
        </div>`);
      });
    }
    
    return slides;
  }

  formatSectionContent(section) {
    if (section.items && Array.isArray(section.items)) {
      return section.items.slice(0, 3).map(item => 
        `<p>${item.number}. ${item.title}</p>`
      ).join('');
    }
    
    if (section.steps && Array.isArray(section.steps)) {
      return section.steps.slice(0, 3).map(step => 
        `<p>${step.title}</p>`
      ).join('');
    }
    
    if (typeof section.content === 'string') {
      return `<p>${section.content.slice(0, 200)}${section.content.length > 200 ? '...' : ''}</p>`;
    }
    
    return '<p>Content coming soon...</p>';
  }

  calculateScriptDuration(script) {
    // Estimate duration based on word count (average 150 words per minute)
    let totalWords = 0;
    
    if (script.hook) totalWords += script.hook.text.split(' ').length;
    if (script.introduction) {
      totalWords += (script.introduction.greeting || '').split(' ').length;
      totalWords += (script.introduction.topicIntro || '').split(' ').length;
    }
    
    if (script.mainContent && script.mainContent.sections) {
      script.mainContent.sections.forEach(section => {
        if (typeof section.content === 'string') {
          totalWords += section.content.split(' ').length;
        }
        if (section.items) {
          section.items.forEach(item => {
            totalWords += (item.title + ' ' + item.description).split(' ').length;
          });
        }
        if (section.steps) {
          section.steps.forEach(step => {
            totalWords += (step.title + ' ' + step.description).split(' ').length;
          });
        }
      });
    }
    
    if (script.conclusion) {
      totalWords += script.conclusion.finalThought.split(' ').length;
    }
    
    // Convert to duration (150 words per minute)
    return Math.max(30, Math.ceil((totalWords / 150) * 60));
  }

  async addAudioToVideo(videoPath, audioPath, outputPath) {
    const hasRealAudio = await this.isUsableAudioFile(audioPath);

    if (!hasRealAudio) {
      this.logger.warn('No narration audio available — producing silent video. Configure OpenAI, ElevenLabs, or Azure Speech for narration.');
      if (videoPath !== outputPath) {
        await fs.copyFile(videoPath, outputPath);
      }
      return outputPath;
    }

    // FFmpeg cannot write to its own input, so mux to a temp file when paths collide
    const muxPath = outputPath === videoPath
      ? outputPath.replace(/\.mp4$/i, '_muxed.mp4')
      : outputPath;

    await runFFmpeg(['-y', '-i', videoPath, '-i', audioPath, '-c:v', 'copy', '-c:a', 'aac', '-shortest', muxPath]);

    if (muxPath !== outputPath) {
      await fs.rename(muxPath, outputPath);
    }

    this.logger.info('Audio added to video successfully');
    return outputPath;
  }

  async isUsableAudioFile(audioPath) {
    if (typeof audioPath !== 'string' || audioPath.endsWith('.info')) {
      return false;
    }

    try {
      const stats = await fs.stat(audioPath);
      return stats.isFile() && stats.size > 0;
    } catch (error) {
      return false;
    }
  }

  async downloadVideo(url, outputPath) {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    const writer = require('fs').createWriteStream(outputPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }

  async cleanupDirectory(dirPath) {
    try {
      const files = await fs.readdir(dirPath);
      for (const file of files) {
        await fs.unlink(path.join(dirPath, file));
      }
      await fs.rmdir(dirPath);
    } catch (error) {
      this.logger.warn('Cleanup failed:', error.message);
    }
  }

  async generateThumbnail(script, style = "cartoon") {
    this.logger.info('Generating custom 2D Cartoon Storytime thumbnail...');

    try {
      const prompt = `YouTube thumbnail for 2D cartoon storytime "${script.title}", funny anime character shock expression, vibrant cartoon background, comic style, high contrast clickbait, engaging 4k`;
      const thumbnailPath = path.join(__dirname, '..', 'uploads', 'thumbnails', `thumbnail_${Date.now()}.png`);

      await this.generateImage(prompt, thumbnailPath);

      return {
        path: thumbnailPath,
        dimensions: { width: 1280, height: 720 },
        fileSize: await this.getFileSize(thumbnailPath)
      };
    } catch (error) {
      this.logger.error('Thumbnail generation failed:', error);
      return await this.simulateThumbnailGeneration(script, style);
    }
  }

  async getFileSize(filePath) {
    const stats = await fs.stat(filePath);
    return stats.size;
  }

  // Simulation methods for when APIs are not available
  async simulateTTSGeneration(text, outputPath) {
    this.logger.info('Simulating TTS generation...');
    
    const infoPath = outputPath + '.info';
    await fs.writeFile(infoPath, JSON.stringify({
      message: 'AI TTS audio would be generated here',
      text: text.substring(0, 100) + '...',
      timestamp: new Date().toISOString()
    }, null, 2));
    
    return infoPath;
  }

  async simulateVisualAssets(prompt, style, count) {
    this.logger.info(`Simulating ${count} visual assets...`);
    
    const paths = [];
    for (let i = 0; i < count; i++) {
      const assetPath = path.join(__dirname, '..', 'data', 'assets', `visual_sim_${Date.now()}_${i}.info`);
      
      await fs.writeFile(assetPath, JSON.stringify({
        message: 'AI visual asset would be generated here',
        prompt: prompt,
        style: style,
        timestamp: new Date().toISOString()
      }, null, 2));
      
      paths.push(assetPath);
    }
    
    return paths;
  }

  async simulateVideoGeneration(script, visualAssets, audioPath, outputPath) {
    this.logger.info('Simulating video generation...');
    
    const infoPath = outputPath + '.info';
    await fs.writeFile(infoPath, JSON.stringify({
      message: 'AI video would be generated here',
      script: script.title,
      visualAssets: visualAssets.length,
      audioPath: audioPath,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    return infoPath;
  }

  async simulateThumbnailGeneration(script, style) {
    this.logger.info('Simulating thumbnail generation...');
    
    const thumbnailPath = path.join(__dirname, '..', 'uploads', 'thumbnails', `thumbnail_sim_${Date.now()}.info`);
    await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
    
    await fs.writeFile(thumbnailPath, JSON.stringify({
      message: 'AI thumbnail would be generated here',
      title: script.title,
      style: style,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    return {
      path: thumbnailPath,
      dimensions: { width: 1792, height: 1024 },
      fileSize: 1024,
      simulated: true
    };
  }
}

module.exports = { AIVideoGenerator };