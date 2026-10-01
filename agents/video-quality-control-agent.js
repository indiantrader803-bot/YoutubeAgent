const { getVideoMetadata } = require('@remotion/renderer');
const { Logger } = require('../utils/logger');
const { AITextService } = require('../utils/ai-text-service');

// Publish gate: every video must clear this bar (0-100) across the QC agents.
const MIN_SCORE = parseInt(process.env.QC_MIN_SCORE || '70', 10);

// Fresh storylines/styles rotate per video so the channel never repeats one look.
const STYLE_ROTATION = [
  { id: 'documentary', instruction: 'Documentary narration style: authoritative, cinematic pacing, slow reveals, "consider this…" beats.' },
  { id: 'energetic-host', instruction: 'Energetic YouTuber style: high-energy delivery, direct questions to the viewer ("what would YOU do?"), punchy one-line sentences.' },
  { id: 'storytime', instruction: 'Narrative storytime style: third-person storytelling with named characters, cliffhanger beats, emotional stakes.' },
  { id: 'explainer', instruction: 'Explainer style: numbered breakdowns, "here is why" logic chains, concrete everyday examples.' },
  { id: 'myth-hunter', instruction: 'Myth-vs-reality style: open with a common belief, dismantle it with facts, rebuild the surprising truth.' },
  { id: 'list-shock', instruction: 'Rapid-fire list style: countdown of shocking facts, escalating surprises, strongest fact last.' }
];

class VideoQualityControlAgent {
  constructor(db, credentials) {
    this.db = db;
    this.credentials = credentials;
    this.logger = new Logger('VideoQualityControl');
    const creds = credentials?.credentials || credentials || {};
    this.aiTextService = new AITextService(creds, {
      primary: creds.nvidia_script
        ? { apiKey: creds.nvidia_script.apiKey, model: creds.nvidia_script.model, baseURL: 'https://integrate.api.nvidia.com/v1', name: 'Nvidia QC (Gemma)' }
        : undefined
    });
  }

  async initialize() {
    this.logger.info(`Video quality-control agent initialized (min score ${MIN_SCORE}, AI reviewers ${this.aiTextService.isAvailable() ? 'ON' : 'OFF'})`);
    return true;
  }

  /** Rotating style so every video looks/feels different from the previous ones. */
  pickStyle(runIndex) {
    return STYLE_ROTATION[((runIndex % STYLE_ROTATION.length) + STYLE_ROTATION.length) % STYLE_ROTATION.length];
  }

  /**
   * Full multi-agent QC chain. Returns
   * { approved, score, agents, reasons[] } — approved=false blocks the upload.
   * Hard-fails on technical problems; AI reviewers contribute weighted scores.
   */
  async reviewVideo(videoPath, { script, strategy, isShort } = {}) {
    const agents = {};
    const reasons = [];
    let score = 100;

    // ── Agent 1: Technical probe (hard gate) ──
    const probe = await this.probeVideo(videoPath);
    agents.technical = { score: probe.ok ? 100 : 0, details: probe };
    if (!probe.ok) {
      score = 0;
      reasons.push(...probe.problems);
    } else {
      score -= Math.min(20, probe.warnings.length * 5);
      if (probe.warnings.length) reasons.push(...probe.warnings);
    }

    // Reconstruct the narration text for the AI reviewers.
    const bundle = [script?.title, script?.hook]
      .concat((script?.mainContent?.sections || []).flatMap(s => s.content || []))
      .concat([script?.callToAction])
      .filter(Boolean)
      .join('\n');
    const narration = bundle.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

    // ── Agent 2: Virality scorer (AI, 40% weight) ──
    if (this.aiTextService.isAvailable() && narration.length > 40) {
      try {
        const prompt = `You are a strict YouTube performance analyst. Rate this ${isShort ? 'YouTube Short' : 'video'} script${strategy?.categoryName ? ` in the "${strategy.categoryName}" niche` : ''} for its potential to get views and likes from cold audiences (0-100).

Script:
"""
${narration.slice(0, 6000)}
"""

Judge: hook strength (first 3 seconds), curiosity retention, emotional pull, clarity, rewatch value, comment-bait ending. Penalize: generic openings, rambling, weak endings, fabricated-sounding claims.

Return ONLY valid JSON: {"score": <number 0-100>, "verdict": "<one sentence>", "improvements": "<one sentence>"}`;
        const resp = await this.aiTextService.generateText(prompt, { maxTokens: 300, temperature: 0.3 });
        const parsed = this._parseJson(resp);
        if (parsed && typeof parsed.score === 'number') {
          agents.virality = {
            score: parsed.score,
            verdict: parsed.verdict || '',
            improvement: parsed.improvements || ''
          };
          score = Math.round(score * 0.6 + parsed.score * 0.4);
        }
      } catch (err) {
        agents.virality = { score: null, error: err.message };
      }
    } else {
      agents.virality = { score: null, skipped: 'AI reviewer unavailable' };
    }

    // ── Agent 3: Policy-compliance reviewer (AI, hard-veto power) ──
    if (this.aiTextService.isAvailable() && narration.length > 40) {
      try {
        const prompt = `You are a YouTube policy compliance officer. Review this ${isShort ? 'Short' : 'video'} script for content that could get the channel a strike, demonetization, or removal.

Script:
"""
${narration.slice(0, 6000)}
"""

Check: medical/financial dangerous advice, violence or graphic content, hate or harassment, misinformation presented as fact, scam patterns, copyright traps (lyrics/quotes), anything violating YouTube Community Guidelines.

Return ONLY valid JSON: {"compliant": true/false, "risk": "none|low|medium|high", "issues": ["..."]}`;
        const resp = await this.aiTextService.generateText(prompt, { maxTokens: 300, temperature: 0.2 });
        const parsed = this._parseJson(resp);
        if (parsed && typeof parsed.compliant === 'boolean') {
          const risk = String(parsed.risk || 'low').toLowerCase();
          const veto = !parsed.compliant || risk === 'high';
          agents.policy = { compliant: parsed.compliant, risk, issues: parsed.issues || [], veto };
          if (veto) {
            score = 0;
            reasons.push(`Policy agent veto: ${(parsed.issues || ['high-risk content']).join('; ')}`);
          } else if (risk === 'medium') {
            score -= 15;
            reasons.push(`Policy risk (medium): ${(parsed.issues || []).join('; ')}`);
          }
        }
      } catch (err) {
        agents.policy = { error: err.message };
      }
    } else {
      agents.policy = { skipped: 'AI reviewer unavailable' };
    }

    const approved = score >= MIN_SCORE;
    const verdict = {
      approved,
      score,
      minScore: MIN_SCORE,
      agents,
      reasons
    };

    this.logger[approved ? 'success' : 'error'](
      `QC verdict: ${approved ? 'APPROVED' : 'REJECTED'} (score ${score}/${MIN_SCORE} needed)` +
      (reasons.length ? ` — ${reasons.join(' | ')}` : '')
    );
    return verdict;
  }

  /**
   * Technical integrity probe of the rendered mp4 via Remotion's renderer
   * (which bundles FFprobe): real video+audio streams, sane duration, size.
   */
  async probeVideo(videoPath) {
    const problems = [];
    const warnings = [];
    let ok = true;

    let stat = null;
    try {
      stat = await fspStat(videoPath);
    } catch (_err) {
      return { ok: false, problems: [`video file missing: ${videoPath}`], warnings: [] };
    }
    if (stat.size < 1024) {
      return { ok: false, problems: [`video file suspiciously small (${stat.size} bytes)`], warnings: [] };
    }

    try {
      const meta = await getVideoMetadata(videoPath);
      // Real field names from @remotion/renderer's getVideoMetadata:
      // codec (video stream, e.g. 'h264'), audioCodec (e.g. 'aac'),
      // durationInSeconds, fps, width, height.
      const vStream = Boolean(meta.codec);
      const aStream = Boolean(meta.audioCodec);
      const duration = Number(meta.durationInSeconds || 0);
      if (!vStream) { ok = false; problems.push('no video stream in mp4 (corrupt or placeholder render)'); }
      if (!aStream) { warnings.push('no audio stream in mp4'); }
      if (!duration || duration < 3) { ok = false; problems.push(`duration too short (${Math.round(duration * 10) / 10}s)`); }
      if (duration > 15 * 60) { warnings.push(`unusually long (${Math.round(duration)}s)`); }
      const fps = Number(meta.fps || 0);
      if (fps > 0 && fps < 15) { warnings.push(`low fps (${fps})`); }
      return {
        ok,
        problems,
        warnings,
        durationSec: Math.round(duration * 10) / 10,
        width: meta.width,
        height: meta.height,
        fps,
        codec: meta.codec,
        audioCodec: meta.audioCodec,
        sizeKB: Math.round(stat.size / 1024)
      };
    } catch (err) {
      return { ok: false, problems: [`probe failed: ${err.message}`], warnings: [] };
    }
  }

  /**
   * Weekly direct-appeal comment on rejected videos (yt policy allows creators
   * one manual review appeal per video; done as a pinned comment on the Short
   * after it has been public for 7 days).
   */
  async scheduleWeeklyAppealComment(videoId, comment) {
    if (!videoId || !comment) return false;
    try {
      const { google } = require('googleapis');
      const auth = this.credentials.getYouTubeAuth();
      const youtube = google.youtube({ version: 'v3', auth });
      await youtube.commentThreads.insert({
        part: 'snippet',
        requestBody: {
          snippet: {
            videoId,
            topLevelComment: { snippet: { textOriginal: comment } }
          }
        }
      });
      this.logger.info(`Posted appeal/engagement comment on ${videoId}`);
      return true;
    } catch (err) {
      this.logger.warn(`Appeal comment failed for ${videoId}: ${err.message}`);
      return false;
    }
  }

  _parseJson(text) {
    if (!text) return null;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fenced ? fenced[1] : text;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch (_err) {
      return null;
    }
  }
}

// Small lazy alias so the fs.promises import stays at the top only once.
function fspStat(p) {
  return require('fs').promises.stat(p);
}

module.exports = { VideoQualityControlAgent, STYLE_ROTATION, QC_MIN_SCORE: MIN_SCORE };
