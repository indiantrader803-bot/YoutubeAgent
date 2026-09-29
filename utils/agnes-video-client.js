const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { Logger } = require('./logger');

/**
 * Client for the vendored Agnes Video Generator service
 * (vendor/agnes-video-generator — free AI text-to-video with Edge-TTS
 * narration and burned-in subtitles; MIT licensed).
 *
 * The service runs locally (it spawns Python/FastAPI on 127.0.0.1) and needs
 * one free key from https://platform.agnes-ai.com in AGNES_API_KEY. When it is
 * not available, callers must be able to fall back to the FFmpeg chain.
 *
 * Flow used from the automation pipeline:
 *   1. ensureServiceReady()  — wait for GET /api/health
 *   2. createManuscriptTask()— POST /api/tasks/manuscript (form-urlencoded)
 *   3. waitForTask()         — poll GET /api/tasks/{id} until completed/failed
 *   4. downloadVideo()       — GET /api/video/{id} → real playable .mp4
 */

const DEFAULT_BASE_URL = process.env.AGNES_BASE_URL || 'http://127.0.0.1:8765';
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'stopped']);

// Edge-TTS (free, no key) voice per narration language — the same language
// roster used by the content matrix (config/language-defaults.js).
const EDGE_TTS_VOICES = {
  en: 'en-US-JennyNeural',
  hi: 'hi-IN-SwaraNeural',
  es: 'es-ES-ElviraNeural',
  pt: 'pt-BR-FranciscaNeural',
  ar: 'ar-SA-ZariyahNeural',
  id: 'id-ID-GadisNeural'
};

function voiceForLanguage(language) {
  return EDGE_TTS_VOICES[(language || 'en').toLowerCase()] || EDGE_TTS_VOICES.en;
}

class AgnesVideoClient {
  constructor(options = {}) {
    this.logger = new Logger('AgnesVideoClient');
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs
      || Number(process.env.AGNES_VIDEO_TIMEOUT_MS)
      || 20 * 60 * 1000;          // 20 min hard cap for the whole render
    this.pollIntervalMs = options.pollIntervalMs || 5000;
    this.requestTimeoutMs = options.requestTimeoutMs || 30000;
  }

  get apiKey() {
    return process.env.AGNES_API_KEY || '';
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  /**
   * True when the local Agnes service answers /api/health.
   * Used as a cheap capability probe before attempting a render.
   */
  async isServiceAvailable() {
    try {
      const res = await axios.get(`${this.baseUrl}/api/health`, { timeout: 5000 });
      return res.status >= 200 && res.status < 500;
    } catch (_) {
      return false;
    }
  }

  async ensureServiceReady(maxWaitMs = 120000) {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      if (await this.isServiceAvailable()) {
        return true;
      }
      await new Promise(res => setTimeout(res, 2000));
    }
    throw new Error(`Agnes service at ${this.baseUrl} did not become ready within ${Math.round(maxWaitMs / 1000)}s`);
  }

  /**
   * Submit a manuscript video task: the narration text is split into
   * segments, each rendered as an AI video clip, then the service adds
   * unified TTS narration + burned-in subtitles and returns a final mp4.
   */
  async createManuscriptTask({ text, language, isShort, title }) {
    if (!text || !String(text).trim()) {
      throw new Error('Agnes manuscript task requires non-empty narration text');
    }

    const width = Number(process.env.AGNES_VIDEO_WIDTH) || (isShort ? 768 : 1280);
    const height = Number(process.env.AGNES_VIDEO_HEIGHT) || (isShort ? 1152 : 720);
    const voice = voiceForLanguage(language);

    const params = new URLSearchParams();
    params.append('manuscript_text', String(text).slice(0, 50000));
    params.append('creative_name', String(title || 'automated_video').slice(0, 80));
    params.append('video_width', String(width));
    params.append('video_height', String(height));
    params.append('audio_enabled', 'true');
    params.append('audio_voice', voice);
    params.append('audio_lang', String(language || 'en'));
    params.append('audio_rate', '+0%');
    params.append('subtitle_enabled', 'true');
    params.append('subtitle_position', 'bottom');
    params.append('execution_mode', 'auto');

    const res = await axios.post(`${this.baseUrl}/api/tasks/manuscript`, params.toString(), {
      timeout: this.requestTimeoutMs,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      // 422 voice-compat errors include the voice + supported languages —
      // surface them verbatim so the fix (different voice/lang pair) is obvious.
      validateStatus: null,
      responseType: 'json'
    });

    if (res.status >= 400) {
      const detail = res.data && (res.data.detail || res.data.message);
      throw new Error(`Agnes task creation failed (HTTP ${res.status}): ${detail || 'unknown error'}`);
    }
    if (!res.data || !res.data.task_id) {
      throw new Error('Agnes task creation returned no task_id');
    }

    this.logger.info(`Agnes task created: ${res.data.task_id} [${voice}, ${width}x${height}]`);
    return res.data.task_id;
  }

  async getTask(taskId) {
    const res = await axios.get(`${this.baseUrl}/api/tasks/${encodeURIComponent(taskId)}`, {
      timeout: this.requestTimeoutMs
    });
    return res.data;
  }

  /**
   * Poll until the task reaches a terminal state.
   * Returns the final task state object.
   */
  async waitForTask(taskId, timeoutMs = this.timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastStatus = '';
    let lastMessage = '';

    while (Date.now() < deadline) {
      let task;
      try {
        task = await this.getTask(taskId);
      } catch (error) {
        // Transient poll errors (service busy / connection reset) shouldn't
        // kill a render that may be 10 minutes deep. Retry until the deadline.
        this.logger.warn(`Agnes poll error (will retry): ${error.message}`);
        await new Promise(res => setTimeout(res, this.pollIntervalMs));
        continue;
      }

      const status = String(task.status || '').toLowerCase();
      if (status !== lastStatus) {
        this.logger.info(`Agnes task ${taskId}: status=${status}`);
        lastStatus = status;
      }
      if (task.current_message && task.current_message !== lastMessage) {
        lastMessage = task.current_message;
      }

      if (TERMINAL_STATUSES.has(status)) {
        if (status === 'completed') {
          return task;
        }
        throw new Error(
          `Agnes task ${taskId} ended with status '${status}': ${task.error_message || lastMessage || 'no details'}`
        );
      }

      await new Promise(res => setTimeout(res, this.pollIntervalMs));
    }

    throw new Error(`Agnes task ${taskId} timed out after ${Math.round(timeoutMs / 60000)} min (last status: ${lastStatus})`);
  }

  /**
   * Download the finished mp4 into outputPath.
   * Refuses to write anything unless the response really is an mp4
   * (never let a placeholder masquerade as a video).
   */
  async downloadVideo(taskId, outputPath) {
    const res = await axios.get(`${this.baseUrl}/api/video/${encodeURIComponent(taskId)}`, {
      timeout: 120000,
      responseType: 'arraybuffer',
      maxContentLength: 512 * 1024 * 1024
    });

    const contentType = String(res.headers['content-type'] || '');
    if (!contentType.includes('video/mp4')) {
      throw new Error(`Agnes returned '${contentType}' instead of video/mp4 for task ${taskId}`);
    }
    if (!res.data || res.data.length < 10240) {
      throw new Error(`Agnes returned a suspiciously small video (${res.data ? res.data.length : 0} bytes)`);
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, Buffer.from(res.data));

    this.logger.info(`Agnes video downloaded: ${outputPath} (${(res.data.length / 1024 / 1024).toFixed(1)} MB)`);
    return outputPath;
  }

  /**
   * Full render: manuscript → poll → download.
   * Throws on any failure so callers can fall back to the local FFmpeg chain.
   */
  async renderManuscriptVideo({ text, language, isShort, title }, outputPath) {
    await this.ensureServiceReady();
    const taskId = await this.createManuscriptTask({ text, language, isShort, title });
    try {
      await this.waitForTask(taskId);
      return await this.downloadVideo(taskId, outputPath);
    } catch (error) {
      this.logger.error(`Agnes render failed for task ${taskId}: ${error.message}`);
      throw error;
    }
  }
}

module.exports = {
  AgnesVideoClient,
  voiceForLanguage,
  EDGE_TTS_VOICES
};
