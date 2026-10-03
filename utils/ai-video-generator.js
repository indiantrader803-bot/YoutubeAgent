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
    const { AICinematicEngine } = require('./ai-cinematic-engine');
    const { OpenMontageBridge } = require('./openmontage-bridge');

    this.ttsProvider = new TTSProvider();
    this.subtitleProvider = new SubtitleProvider();
    this.imageProvider = new ImageProvider();
    this.pexelsVideoProvider = new PexelsVideoProvider(credentials.pexels?.apiKey || process.env.PEXELS_API_KEY);
    this.videoAssembler = new VideoAssembler();
    this.storytimeEngine = new StorytimeAnimationEngine();
    this.cinematicEngine = new AICinematicEngine();
    this.openMontage = new OpenMontageBridge();
  }

  async generateTTSAudio(text, outputPath, options = {}) {
    // Narration language (BCP-47-ish code from the content matrix).
    const language = options.language || process.env.TTS_LANGUAGE || 'en';
    this.logger.info(`Generating TTS narration audio [${language}]...`);
    
    // 1. High-Quality Natural TTS (Direct Google Voiceover / Kokoro)
    try {
      this.logger.info('Generating natural voiceover narration via TTS Provider...');
      const genPath = await this.ttsProvider.generate(text, outputPath, { language });
      if (genPath && await fs.stat(outputPath).then(s => s.size > 500).catch(() => false)) {
        this.logger.info(`TTS voiceover audio generated successfully (${(await fs.stat(outputPath)).size} bytes) [${language}]`);
        return outputPath;
      }
    } catch (err) {
      this.logger.warn(`TTS Provider direct generation failed: ${err.message}, trying cloud services...`);
    }

    // 2. ElevenLabs (Professional Studio Voiceover)
    if (this.elevenLabsApiKey && this.elevenLabsVoiceId) {
      try {
        this.logger.info('Using ElevenLabs TTS for studio quality narration...');
        return await this.generateElevenLabsTTS(text, outputPath, language);
      } catch (err) {
        this.logger.warn(`ElevenLabs TTS failed, trying fallbacks: ${err.message}`);
      }
    }

    // 3. OpenAI TTS
    if (this.openai) {
      try {
        this.logger.info('Using OpenAI TTS fallback...');
        return await this.generateOpenAITTS(text, outputPath, language);
      } catch (err) {
        this.logger.warn(`OpenAI TTS fallback failed: ${err.message}`);
      }
    }

    // 4. Gemini native TTS (free tier)
    if (this.gemini) {
      try {
        this.logger.info('Using Gemini TTS fallback...');
        return await this.generateGeminiTTS(text, outputPath, language);
      } catch (err) {
        this.logger.warn(`Gemini TTS fallback failed: ${err.message}`);
      }
    }

    // 5. Final fallback to Web Fallback (language-aware Google voices)
    try {
      return await this.ttsProvider.generateWebFallback(text, outputPath, { language });
    } catch (e) {
      this.logger.error(`All TTS methods failed: ${e.message}`);
      throw e;
    }
  }

  async generateElevenLabsTTS(text, outputPath, language = 'en') {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.elevenLabsVoiceId}`;
    
    const data = {
      text: text,
      model_id: "eleven_v3",
      // ElevenLabs v3 is multilingual — the language code nudges pronunciation
      // and accent for non-English narration.
      ...(language && language !== 'en' ? { language_code: language } : {}),
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

  async generateOpenAITTS(text, outputPath, language = 'en') {
    // OpenAI TTS auto-detects the input language; the instructions parameter
    // steers the voice toward native-sounding delivery for non-English text.
    const instructions = language && language !== 'en'
      ? `Speak naturally as a native ${language} speaker.`
      : undefined;
    const response = await this.openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "coral",
      input: text,
      ...(instructions ? { instructions } : {}),
      speed: 1.0
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(outputPath, buffer);

    this.logger.info('OpenAI TTS generation complete');
    return outputPath;
  }

  async generateGeminiTTS(text, outputPath, _language = 'en') {
    // Gemini TTS auto-detects the language from the text itself, so the
    // language parameter is intentionally unused here (kept for signature
    // parity with the other TTS engines).
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

    // ── Visual style routing ──────────────────────────────────────────
    // The daily batch rotates visualRenderer (cartoon / AI-cinematic / 3D /
    // realistic / cloud-AI) so each upload looks different. Legacy scripts
    // (videoStyle 'storytime' or style 'cartoon') keep the cartoon engine;
    // scripts with no style marker default by VIDEO_MODE exactly as before.
    const resolveTargetRenderer = () => {
      const renderer = script?.visualRenderer || script?.metadata?.strategy?.visualRenderer;
      if (renderer) return String(renderer);
      const visual = String(script?.visualStyle || script?.metadata?.strategy?.visualStyle || '').toLowerCase();
      if (visual === '2d-cartoon') return 'storytime';
      if (visual === 'realistic') return 'stock';
      if (visual === 'ai-cinematic') return 'cinematic';
      if (visual === 'motion-3d') return 'cinematic3d';
      if (visual === 'json2video-motion') return 'json2video';
      if (script?.videoStyle === 'storytime' || script?.style === 'cartoon') return 'storytime';
      return process.env.VIDEO_MODE === 'stock' ? 'stock' : 'storytime';
    };
    const targetRenderer = resolveTargetRenderer();
    this.logger.info(`Visual renderer for "${script?.title || 'untitled'}": ${targetRenderer}${isShort ? ' (Short)' : ''}`);

    // 1. Try OpenMontage Studio Pipeline if requested
    if ((script?.pipeline === 'openmontage' || script?.videoStyle === 'openmontage') && this.openMontage) {
      try {
        this.logger.info('🚀 Launching OpenMontage Studio Pipeline...');
        const demoName = script?.demoName || 'world-in-numbers';
        return await this.openMontage.renderDemo(demoName, outputPath);
      } catch (omErr) {
        this.logger.warn(`OpenMontage pipeline fallback (${omErr.message})...`);
      }
    }

    // 2. Cloud AI render (json2video) — Shorts only (free plan caps at 60s),
    //    quota-gated with graceful fallback to the local engines.
    if (targetRenderer === 'json2video' && isShort && this.json2videoApiKey) {
      try {
        this.logger.info('🚀 Launching json2video cloud AI render...');
        await this.renderJson2Video(script, audioPath, outputPath, { isShort });
        return outputPath;
      } catch (j2vErr) {
        this.logger.warn(`json2video render unavailable (${j2vErr.message}). Falling back to the AI-cinematic engine...`);
      }
    }

    // 3. AI Cinematic engine — procedural motion-graphics scenes (2.5D / 3D
    //    parallax). Used for 'cinematic' + 'cinematic3d' targets and as the
    //    fallback when the cloud renderer is unavailable.
    if ((targetRenderer === 'cinematic' || targetRenderer === 'cinematic3d' || targetRenderer === 'json2video') && this.cinematicEngine) {
      try {
        this.logger.info('🚀 Launching AI Cinematic Studio (procedural motion-graphics engine)...');
        return await this.cinematicEngine.renderCinematicVideo(script, audioPath, outputPath, { isShort });
      } catch (cineErr) {
        this.logger.warn(`AI-cinematic engine fallback (${cineErr.message}). Trying the 2D cartoon engine next...`);
      }
    }

    // 4. 2D Cartoon Storytime Animation Engine (category-themed scenes +
    //    one-line bottom captions)
    const wantsStorytime = targetRenderer === 'storytime';
    if (wantsStorytime && this.storytimeEngine) {
      try {
        this.logger.info('🚀 Launching 2D Cartoon Storytime Studio (themed animation engine)...');
        return await this.storytimeEngine.renderStorytimeVideo(script, audioPath, outputPath, { isShort });
      } catch (storyErr) {
        this.logger.warn(`Storytime animation engine fallback (${storyErr.message}). Using Pexels stock video assembler...`);
      }
    }

    // 3. Try the vendored Agnes Video Generator (free AI text-to-video with
    //    Edge-TTS narration + burned-in subtitles). Activated by AGNES_API_KEY;
    //    requires its local Python service to be running (DailyAutomation
    //    brings it up via ensureAgnesService() in the cron path).
    if (process.env.AGNES_API_KEY && !this.agnesClient) {
      const { AgnesVideoClient } = require('./agnes-video-client');
      this.agnesClient = new AgnesVideoClient();
    }
    if (this.agnesClient) {
      try {
        this.logger.info('🚀 Launching Agnes Video Generator render (free AI text-to-video)...');
        const narrationText = script?.narrationText
          || script?.hook?.text
          || script?.title
          || 'A short story worth telling. Subscribe for more.';
        await this.agnesClient.renderManuscriptVideo(
          {
            text: narrationText,
            language: script?.language || 'en',
            isShort,
            title: script?.title
          },
          outputPath
        );
        return outputPath;
      } catch (agnesErr) {
        this.logger.warn(`Agnes renderer unavailable or failed (${agnesErr.message}). Falling back to the FFmpeg stock-footage chain...`);
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

  // ────────────────────────────────────────────────────────────────────────
  // json2video cloud renderer (best-model accent path)
  //
  // Verified against the live v2 API (probe: 8s render, AI images OK):
  //   POST https://api.json2video.com/v2/movies  → { success, project }
  //   GET  https://api.json2video.com/v2/movies?project=… → { movie: { status, url } }
  //   element: { type: 'image', ai: true, prompt, duration }
  // Free plan: 600 s/month quota, 60 s max per video → Shorts only, with a
  // quota pre-check so we never silently burn credits or fail mid-run.
  // Narration is muxed locally afterwards and one-line bottom captions are
  // burned from the script's own chunks.
  // ────────────────────────────────────────────────────────────────────────
  async renderJson2Video(script, audioPath, outputPath, { isShort = false } = {}) {
    if (!this.json2videoApiKey) {
      throw new Error('JSON2VIDEO_API_KEY not configured');
    }
    const headers = { 'x-api-key': this.json2videoApiKey, 'Content-Type': 'application/json' };

    // 1. Duration (cloud free plan hard-caps at 60s)
    let duration = await this.videoAssembler.getDuration(audioPath);
    if (!duration || duration < 5) {
      duration = this.calculateScriptDuration(script) || 30;
    }
    duration = Math.min(duration, 58);

    // 2. Quota pre-check (render seconds + safety buffer)
    try {
      const acct = await axios.get('https://api.json2video.com/v2/account', { headers, timeout: 20000 });
      const remaining = acct.data?.remaining_quota?.time;
      const need = Math.ceil(duration) + 40;
      if (typeof remaining === 'number' && remaining < need) {
        throw new Error(`json2video quota too low: ${remaining}s left, need ~${need}s`);
      }
      this.logger.info(`json2video quota check OK (${typeof remaining === 'number' ? remaining + 's' : 'unknown'} remaining, need ~${need}s)`);
    } catch (qErr) {
      if (qErr.message && qErr.message.startsWith('json2video quota')) throw qErr;
      this.logger.warn(`json2video quota check failed (${qErr.message}) — proceeding cautiously`);
    }

    // 3. Build AI scenes from the script sections
    const sections = (script?.mainContent?.sections || []).filter((s) => (Array.isArray(s.content) ? s.content.join(' ') : s.content || s.title));
    const usable = sections.length > 0 ? sections : [
      { title: script?.title || 'Today\'s Story', content: [script?.hook?.text || script?.hook || 'A story worth telling.'] }
    ];
    const sceneCount = Math.max(3, Math.min(8, usable.length));
    const perScene = duration / sceneCount;
    const categoryWords = this.json2videoSceneWords(script);

    const scenes = [];
    for (let i = 0; i < sceneCount; i++) {
      const sec = usable[Math.min(i, usable.length - 1)];
      const secText = Array.isArray(sec.content) ? sec.content.join(' ') : (sec.content || '');
      const imagePrompt = `${sec.title || script?.title || 'cinematic scene'}, ${String(secText).slice(0, 120)}, ${categoryWords}, cinematic lighting, ultra detailed, photorealistic, no text, no watermark`;
      scenes.push({
        comment: `scene ${i + 1}`,
        duration: Math.max(2, Math.round(perScene)),
        elements: [
          { type: 'image', ai: true, prompt: imagePrompt.slice(0, 400), duration: Math.max(2, Math.round(perScene)) },
          { type: 'text', text: String(sec.title || script?.title || '').toUpperCase().slice(0, 42), duration: Math.max(2, Math.round(perScene)) }
        ]
      });
    }

    const project = {
      resolution: 'custom',
      width: isShort ? 720 : 1920,
      height: isShort ? 1280 : 1080,
      quality: 'high',
      scenes
    };

    // 4. Submit render
    const post = await axios.post('https://api.json2video.com/v2/movies', project, { headers, timeout: 30000 });
    const projectId = post.data?.project;
    if (!projectId) {
      throw new Error(`json2video submit failed: ${JSON.stringify(post.data).slice(0, 200)}`);
    }
    this.logger.info(`json2video project submitted: ${projectId} (${sceneCount} scenes, ${duration.toFixed(0)}s)`);

    // 5. Poll until done (renders take ~1-2 min per Short)
    let movieUrl = null;
    for (let i = 0; i < 48; i++) {
      await new Promise((r) => setTimeout(r, 10000));
      const stat = await axios.get(`https://api.json2video.com/v2/movies?project=${projectId}`, { headers, timeout: 30000 });
      const movie = stat.data?.movie || stat.data || {};
      if (movie.status === 'done' && movie.url) {
        movieUrl = movie.url;
        break;
      }
      if (movie.status === 'error' || movie.error) {
        throw new Error(`json2video render error: ${JSON.stringify(movie.error || movie.message).slice(0, 300)}`);
      }
      if (i % 3 === 2) this.logger.info(`json2video still rendering (${(i + 1) * 10}s)...`);
    }
    if (!movieUrl) {
      throw new Error('json2video render timed out after 8 minutes');
    }

    // 6. Download the rendered MP4
    const tempDir = path.join(path.dirname(outputPath), `temp_j2v_${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    const cloudVideoPath = path.join(tempDir, 'cloud_render.mp4');
    const download = await axios.get(movieUrl, { responseType: 'arraybuffer', timeout: 180000 });
    await fs.writeFile(cloudVideoPath, Buffer.from(download.data));
    this.logger.info(`json2video render downloaded (${(await fs.stat(cloudVideoPath)).size} bytes)`);

    try {
      // 7. Burn one-line bottom captions from the narration chunks
      const srtPath = path.join(tempDir, 'captions.srt');
      await this.writeCaptionSrt(script, duration, srtPath);
      const captionedPath = path.join(tempDir, 'captioned.mp4');
      const srtFilter = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      await runFFmpeg([
        '-y',
        '-i', cloudVideoPath,
        '-vf', `subtitles=filename='${srtFilter}':force_style='FontSize=15,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=24'`,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-an',
        captionedPath
      ]);

      // 8. Mux the narration
      await this.videoAssembler.muxAudio(captionedPath, audioPath, outputPath);
      this.logger.info(`🎉 json2video cloud AI video generated: ${outputPath}`);
      return outputPath;
    } finally {
      await this.cleanupDirectory(tempDir).catch(() => {});
    }
  }

  /** Per-category scene look words for json2video AI image prompts. */
  json2videoSceneWords(script) {
    const categoryId = script?.metadata?.strategy?.categoryId || script?.categoryId || '';
    const map = {
      space: 'deep space, nebulae, galaxies, planets, telescope views, cosmic dust',
      'future-ai': 'futuristic technology, glowing neural networks, holographic interfaces, robotics',
      'dark-psychology': 'moody noir atmosphere, silhouettes, mist, dramatic shadows, mind imagery',
      'history-what-if': 'historical settings, ancient architecture, aged film look, dramatic skies',
      survival: 'wilderness, extreme nature, dramatic landscapes, survival gear'
    };
    return map[categoryId] || 'cinematic, dramatic lighting, rich detail';
  }

  /**
   * Build an SRT of short one-line captions from the script sections,
   * time-sliced evenly across the narration duration (same chunking rules as
   * the Remotion compositions).
   */
  async writeCaptionSrt(script, totalDurationSeconds, outputPath) {
    const sections = script?.mainContent?.sections || [];
    const usable = sections.length > 0 ? sections : [{ content: [script?.title || 'Subscribe for daily stories.'] }];
    const perSection = totalDurationSeconds / usable.length;

    const fmt = (s) => {
      const ms = Math.max(0, Math.round(s * 1000));
      const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
      const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
      const sec = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
      const rest = String(ms % 1000).padStart(3, '0');
      return `${h}:${m}:${sec},${rest}`;
    };

    let srt = '';
    let index = 1;
    usable.forEach((sec, si) => {
      const text = Array.isArray(sec.content) ? sec.content.join(' ') : (sec.content || '');
      const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
      const chunks = [];
      let cur = [];
      for (const w of words) {
        if (cur.length >= 7 || [...cur, w].join(' ').length > 46) {
          chunks.push(cur.join(' '));
          cur = [w];
        } else {
          cur.push(w);
        }
      }
      if (cur.length > 0) chunks.push(cur.join(' '));
      if (chunks.length === 0) return;

      const chunkLen = perSection / chunks.length;
      chunks.forEach((chunk, ci) => {
        const start = si * perSection + ci * chunkLen;
        const end = start + chunkLen - 0.05;
        srt += `${index++}\n${fmt(start)} --> ${fmt(end)}\n${chunk}\n\n`;
      });
    });

    await fs.writeFile(outputPath, srt, 'utf8');
    return outputPath;
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

    await runFFmpeg([
      '-y',
      '-i', videoPath,
      '-i', audioPath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-af', 'volume=1.8',
      '-shortest',
      muxPath
    ]);

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

  async generateThumbnail(script, style = null) {
    // Thumbnail art follows the video's visual style instead of a fixed look.
    const visual = String(style || script?.visualStyle || script?.metadata?.strategy?.visualStyle || 'ai-cinematic').toLowerCase();
    const stylePrompts = {
      '2d-cartoon': `YouTube thumbnail for a 2D cartoon story "${script.title}", expressive cartoon character with shocked face, vibrant flat illustration background, bold outlines, comic style, high contrast clickbait`,
      'ai-cinematic': `YouTube thumbnail for "${script.title}", dramatic AI cinematic key art, volumetric lighting, epic scene, glowing accents, ultra detailed, high contrast clickbait`,
      'motion-3d': `YouTube thumbnail for "${script.title}", glossy 3D render key art, futuristic depth, neon rim lighting, floating glass shapes, ultra detailed, high contrast clickbait`,
      realistic: `YouTube thumbnail for "${script.title}", photorealistic dramatic photography, cinematic color grade, sharp focus subject, high contrast clickbait`,
      'json2video-motion': `YouTube thumbnail for "${script.title}", polished motion-graphics poster, dynamic gradients, bold shapes, high contrast clickbait`
    };
    const prompt = stylePrompts[visual] || stylePrompts['ai-cinematic'];
    this.logger.info(`Generating custom thumbnail [${visual}]...`);

    try {
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