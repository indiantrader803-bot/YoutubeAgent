const OpenAI = require('openai');
const { Logger } = require('./logger');

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
    envKey: 'OPENAI_API_KEY',
  },
  groq: {
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b'],
    envKey: 'GROQ_API_KEY',
  },
  openrouter: {
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-5.5',
    models: ['openai/gpt-5.5', 'anthropic/claude-opus-4-8', 'google/gemini-3.5-flash', 'moonshotai/kimi-k2.6', 'zhipu/glm-5'],
    envKey: 'OPENROUTER_API_KEY',
  },
  kimi: {
    name: 'Kimi (Moonshot AI)',
    baseURL: 'https://api.moonshot.ai/v1',
    defaultModel: 'kimi-k2.6',
    models: ['kimi-k2.6', 'kimi-k2.5', 'moonshot-v1-auto'],
    envKey: 'MOONSHOT_API_KEY',
  },
  mimo: {
    name: 'MiMo (Xiaomi)',
    baseURL: 'https://api.xiaomimimo.com/v1',
    defaultModel: 'mimo-v2.5-pro',
    models: ['mimo-v2.5-pro', 'mimo-v2.5'],
    envKey: 'MIMO_API_KEY',
  },
  nvidia: {
    name: 'Nvidia NIM',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'openai/gpt-oss-20b',
    models: ['openai/gpt-oss-20b', 'meta/llama-3.3-70b-instruct'],
    envKey: 'NVIDIA_API_KEY',
  },
};

// Per-provider wall-clock budget before we abandon it and try the next one.
const PROVIDER_TIMEOUT_MS = Number(process.env.AI_PROVIDER_TIMEOUT_MS) || 12000;

class AITextService {
  /**
   * @param {object} credentials Full credential bag (used to build the failover chain).
   * @param {{primary?: {apiKey?: string, model?: string, baseURL?: string, name?: string}}} [options]
   *        Agent-specific preferred primary, tried before anything else.
   */
  constructor(credentials = {}, options = {}) {
    this.logger = new Logger('AITextService');
    this.client = null;
    this.gemini = null;
    this.model = null;
    this.providerName = null;
    /**
     * Ordered list of usable providers. The first entry is the configured
     * primary; the rest are automatic fallbacks so a single dead provider
     * cannot silently degrade every generation to a template.
     * @type {Array<{kind:'openai'|'gemini',name:string,client?:object,gemini?:object,model?:string,timeoutMs:number,dead:boolean}>}
     */
    this.providers = [];

    this._init(credentials, options);

    // Backwards-compatible single-provider view.
    const primary = this.providers[0];
    if (primary) {
      this.client = primary.client || null;
      this.gemini = primary.gemini || null;
      this.model = primary.model || null;
      this.providerName = primary.name;
    }
  }

  _init(credentials, options = {}) {
    const seen = new Set();

    const addOpenAICompatible = (name, apiKey, baseURL, model, timeoutMs = PROVIDER_TIMEOUT_MS) => {
      if (!apiKey || !baseURL) return;
      const dedupeKey = `${baseURL}::${apiKey.slice(0, 8)}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      this.providers.push({
        kind: 'openai',
        name,
        baseURL,
        model: model || undefined,
        timeoutMs,
        dead: false,
        client: new OpenAI({ apiKey, baseURL, timeout: timeoutMs, maxRetries: 0 }),
      });
    };

    const addGemini = (apiKey, model, timeoutMs = PROVIDER_TIMEOUT_MS) => {
      if (!apiKey) return;
      const dedupeKey = `gemini::${apiKey.slice(0, 8)}`;
      if (seen.has(dedupeKey)) return;
      try {
        const { GoogleGenAI } = require('@google/genai');
        seen.add(dedupeKey);
        this.providers.push({
          kind: 'gemini',
          name: 'Google Gemini',
          model: model || 'gemini-3.5-flash',
          timeoutMs,
          dead: false,
          gemini: new GoogleGenAI({ apiKey }),
        });
      } catch (error) {
        this.logger.error('Failed to initialize Gemini:', error.message);
      }
    };

    // 0. Agent-preferred primary (e.g. the strategy/script/SEO department model).
    const preferred = options.primary;
    if (preferred?.apiKey) {
      addOpenAICompatible(
        preferred.name || 'Preferred',
        preferred.apiKey,
        preferred.baseURL || 'https://integrate.api.nvidia.com/v1',
        preferred.model
      );
    }

    // 1. Explicit configuration object.
    if (credentials.apiKey && (credentials.baseURL || credentials.model)) {
      addOpenAICompatible(
        credentials.name || 'Nvidia NIM',
        credentials.apiKey,
        credentials.baseURL || 'https://integrate.api.nvidia.com/v1',
        credentials.model || 'openai/gpt-oss-20b'
      );
    }

    // 2. Per-department credential objects.
    const dept = credentials.nvidia_seo || credentials.nvidia_script || credentials.nvidia_strategy || credentials.nvidia;
    if (dept?.apiKey) {
      addOpenAICompatible('Nvidia NIM', dept.apiKey, 'https://integrate.api.nvidia.com/v1', dept.model || 'openai/gpt-oss-20b');
    }

    // 3. Named provider declared in credentials.json.
    const provider = credentials.aiProvider?.provider;
    if (provider && PROVIDERS[provider] && credentials.aiProvider?.apiKey) {
      addOpenAICompatible(
        PROVIDERS[provider].name,
        credentials.aiProvider.apiKey,
        PROVIDERS[provider].baseURL,
        credentials.aiProvider.model || PROVIDERS[provider].defaultModel
      );
    }

    // 4. Any other provider block present in credentials.json.
    //    Ordered fastest-and-most-likely-to-work first so a hung primary
    //    fails over quickly instead of stalling the pipeline.
    const ORDER = ['groq', 'openrouter', 'kimi', 'mimo', 'openai', 'nvidia', 'gemini'];
    for (const key of ORDER) {
      const block = credentials[key];
      if (!block?.apiKey) continue;
      if (key === 'gemini') {
        addGemini(block.apiKey, block.model);
      } else {
        const preset = PROVIDERS[key] || { name: key, baseURL: undefined };
        addOpenAICompatible(preset.name, block.apiKey, preset.baseURL, block.model || preset.defaultModel);
      }
    }

    // 5. Environment variables (GitHub Actions / .env), same preference order.
    for (const key of ORDER) {
      const preset = PROVIDERS[key];
      if (!preset || !process.env[preset.envKey]) continue;
      addOpenAICompatible(
        preset.name,
        process.env[preset.envKey],
        preset.baseURL,
        process.env[`${key.toUpperCase()}_MODEL`] || preset.defaultModel
      );
    }

    // 6. Gemini env key last (slower, used as a backstop).
    const geminiKey = credentials.gemini?.apiKey || process.env.GEMINI_API_KEY;
    if (geminiKey) addGemini(geminiKey, credentials.gemini?.model || process.env.GEMINI_MODEL);

    if (!this.providers.length) {
      this.logger.warn('No AI text provider configured — text generation unavailable');
      return;
    }

    this.logger.info(
      `AI text providers ready (primary: ${this.providers[0].name}): ${this.providers.map(p => p.name).join(' -> ')}`
    );
  }

  _withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  }

  async _callProvider(provider, { prompt, model, maxTokens, temperature, chatTemplate }) {
    const effectiveModel = model || provider.model;

    if (provider.kind === 'gemini') {
      const response = await this._withTimeout(
        provider.gemini.models.generateContent({
          model: effectiveModel,
          contents: prompt,
          config: { temperature },
        }),
        provider.timeoutMs,
        provider.name
      );
      return response.text;
    }

    const requestPayload = {
      model: effectiveModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature,
    };

    if (chatTemplate || effectiveModel.includes('deepseek')) {
      requestPayload.extra_body = {
        chat_template_kwargs: { thinking: true, reasoning_effort: 'high' }
      };
    }

    // Reasoning models (gpt-oss, qwen3) can emit `max_tokens` worth of
    // reasoning before any answer text, which yields an empty `content`.
    // Give them headroom so real callers are not starved.
    if (/gpt-oss|qwen3|deepseek|thinking/i.test(effectiveModel)) {
      requestPayload.max_tokens = Math.max(maxTokens, 4096);
    }

    const response = await this._withTimeout(
      provider.client.chat.completions.create(requestPayload, { timeout: provider.timeoutMs }),
      provider.timeoutMs,
      provider.name
    );

    const msg = response.choices?.[0]?.message;
    let content = (msg?.content || msg?.reasoning_content || '').toString();

    // Strip out <think>...</think> tags if model returns thinking inline.
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    return content;
  }

  async generateText(prompt, options = {}) {
    if (!this.providers.length) {
      throw new Error('No AI text provider configured');
    }

    const maxTokens = options.maxTokens || 2048;
    const temperature = options.temperature ?? 0.7;
    const failures = [];

    for (const provider of this.providers) {
      if (provider.dead) continue;

      const startedAt = Date.now();
      try {
        const content = await this._callProvider(provider, {
          prompt,
          model: options.model,
          maxTokens,
          temperature,
          chatTemplate: options.chat_template_kwargs,
        });

        if (!content || !content.trim()) {
          throw new Error('empty response');
        }

        if (failures.length) {
          this.logger.info(`AI request recovered via fallback provider ${provider.name}`);
        }
        return content;
      } catch (error) {
        const elapsed = Date.now() - startedAt;
        failures.push(`${provider.name}: ${error.message}`);

        // Circuit-break providers that are unreachable or out of credit so the
        // rest of the run goes straight to a provider that works.
        const permanent = /timed out|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up|49[0-9]|40[13]|quota|no credits|insufficient/i.test(error.message);
        if (permanent) provider.dead = true;

        this.logger.warn(
          `AI provider ${provider.name} failed after ${elapsed}ms (${error.message})` +
            (permanent ? ' — circuit-broken for this run' : '') +
            '; trying next provider'
        );
      }
    }

    throw new Error(`All AI providers failed -> ${failures.join(' | ')}`);
  }

  isAvailable() {
    return this.providers.some(p => !p.dead) || !!(this.client || this.gemini);
  }
}

module.exports = { AITextService, PROVIDERS };
