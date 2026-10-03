const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { Logger } = require('../utils/logger');

class ThumbnailDesignerAgent {
  constructor(db, credentials) {
    this.db = db;
    this.credentials = credentials;
    this.logger = new Logger('ThumbnailDesigner');
    this.templatesPath = path.join(__dirname, '..', 'data', 'thumbnail-templates');
  }

  async initialize() {
    this.logger.info('Initializing Thumbnail Designer Agent...');
    await this.ensureTemplatesDirectory();
    return true;
  }

  async ensureTemplatesDirectory() {
    try {
      await fs.mkdir(this.templatesPath, { recursive: true });
      await fs.mkdir(path.join(__dirname, '..', 'uploads', 'thumbnails'), { recursive: true });
    } catch (error) {
      this.logger.error('Failed to create directories:', error);
    }
  }

  async generateThumbnail(script) {
    try {
      this.logger.info(`Generating thumbnail for: ${script.title}`);
      
      // Generate thumbnail concept
      const concept = await this.generateConcept(script);
      
      // Create thumbnail prompt for AI generation
      const prompt = await this.createPrompt(concept);
      
      // Generate base thumbnail
      const thumbnailPath = await this.createThumbnail(concept);
      
      // Add text overlay
      const finalThumbnail = await this.addTextOverlay(thumbnailPath, concept);
      
      // Optimize for YouTube
      const optimizedThumbnail = await this.optimizeForYouTube(finalThumbnail);
      
      const thumbnailData = {
        path: optimizedThumbnail,
        concept,
        prompt,
        dimensions: { width: 1280, height: 720 },
        fileSize: await this.getFileSize(optimizedThumbnail),
        createdAt: new Date().toISOString()
      };
      
      // Save to database
      await this.db.saveThumbnail(thumbnailData);
      
      this.logger.info('Thumbnail generated successfully');
      return thumbnailData;
    } catch (error) {
      this.logger.error('Failed to generate thumbnail:', error);
      throw error;
    }
  }

  async generateConcept(script) {
    const concepts = {
      tutorial: {
        style: 'clean',
        elements: ['step numbers', 'arrows', 'progress indicators'],
        colors: ['blue', 'white', 'green'],
        emotion: 'helpful'
      },
      explainer: {
        style: 'informative',
        elements: ['icons', 'diagrams', 'question marks'],
        colors: ['purple', 'yellow', 'white'],
        emotion: 'curious'
      },
      list: {
        style: 'numbered',
        elements: ['large numbers', 'countdown', 'highlights'],
        colors: ['red', 'yellow', 'black'],
        emotion: 'exciting'
      },
      review: {
        style: 'comparative',
        elements: ['product image', 'rating stars', 'vs symbol'],
        colors: ['orange', 'gray', 'white'],
        emotion: 'analytical'
      },
      story: {
        style: 'dramatic',
        elements: ['faces', 'emotion', 'journey path'],
        colors: ['dark blue', 'gold', 'white'],
        emotion: 'intriguing'
      }
    };

    const baseConcept = concepts[script.metadata?.strategy?.contentType?.toLowerCase()] || concepts.explainer;
    
    return {
      title: this.formatThumbnailTitle(script.title),
      style: baseConcept.style,
      categoryId: script.metadata?.strategy?.categoryId || 'default',
      visualStyle: script.visualStyle || script.metadata?.strategy?.visualStyle || 'ai-cinematic',
      primaryText: this.extractPrimaryText(script.title),
      secondaryText: this.generateSecondaryText(script),
      elements: baseConcept.elements,
      colors: {
        primary: baseConcept.colors[0],
        secondary: baseConcept.colors[1],
        accent: baseConcept.colors[2]
      },
      emotion: baseConcept.emotion,
      composition: this.selectComposition(),
      effects: this.selectEffects()
    };
  }

  formatThumbnailTitle(title) {
    // Shorten title for thumbnail
    const words = title.split(' ');
    if (words.length > 5) {
      return words.slice(0, 5).join(' ') + '...';
    }
    return title;
  }

  extractPrimaryText(title) {
    // Extract most impactful words
    const impactWords = ['ultimate', 'complete', 'secret', 'truth', 'how', 'why', 'best', 'top', 'guide', 'master'];
    const titleWords = title.toLowerCase().split(' ');
    
    const foundImpactWords = titleWords.filter(word => impactWords.includes(word));
    
    if (foundImpactWords.length > 0) {
      return foundImpactWords[0].toUpperCase();
    }
    
    // Extract numbers if present
    const numbers = title.match(/\d+/);
    if (numbers) {
      return numbers[0];
    }
    
    // Use first significant word
    return titleWords.find(word => word.length > 4)?.toUpperCase() || 'WATCH';
  }

  generateSecondaryText(script) {
    if (script.metadata && script.metadata.strategy) {
      const strategy = script.metadata.strategy;
      
      if (strategy.contentType === 'Tutorial') {
        return 'STEP BY STEP';
      } else if (strategy.contentType === 'List') {
        return 'YOU WON\'T BELIEVE #1';
      } else if (strategy.contentType === 'Review') {
        return 'HONEST REVIEW';
      }
    }
    
    return 'MUST WATCH';
  }

  selectComposition() {
    const compositions = [
      'rule-of-thirds',
      'centered',
      'diagonal',
      'golden-ratio',
      'symmetrical'
    ];
    
    return compositions[Math.floor(Math.random() * compositions.length)];
  }

  selectEffects() {
    return {
      blur: Math.random() > 0.5,
      vignette: Math.random() > 0.7,
      glow: Math.random() > 0.6,
      shadow: true,
      border: Math.random() > 0.8
    };
  }

  async createPrompt(concept) {
    const prompt = `Create a YouTube thumbnail with the following specifications:
    Style: ${concept.style}
    Primary Text: "${concept.primaryText}"
    Secondary Text: "${concept.secondaryText}"
    Color Scheme: ${concept.colors.primary}, ${concept.colors.secondary}, ${concept.colors.accent}
    Elements to include: ${concept.elements.join(', ')}
    Emotional tone: ${concept.emotion}
    Composition: ${concept.composition}
    
    Viral CTR formula (must follow):
    - ONE character with an exaggerated shocked expression
    - ONE oversized object (planet, robot, brain, volcano — match the topic)
    - Text of 3-5 words max, huge bold type
    - Bright yellow, red, and blue palette; high contrast against the background
    - Clean focal point readable at small (mobile) sizes
    
    The thumbnail should be eye-catching, professional, and optimized for high click-through rate.
    Resolution: 1280x720px
    Format: High contrast, bold text, clear imagery`;
    
    return prompt;
  }

  async createThumbnail(concept) {
    const width = 1280;
    const height = 720;
    const outputPath = path.join(__dirname, '..', 'uploads', 'thumbnails', `thumbnail_${Date.now()}.png`);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const isTrading = /trading|crypto|forex|stock|candlestick|chart|breakout|pattern|entry/i.test(
      (concept.title || '') + ' ' + (concept.primaryText || '') + ' ' + (concept.secondaryText || '')
    );

    if (isTrading) {
      // Pro Candlestick Trading Graphic Thumbnail
      const tradingSvg = Buffer.from(`
        <svg width="${width}" height="${height}">
          <defs>
            <linearGradient id="darkBg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#0a0e1a"/>
              <stop offset="50%" stop-color="#111827"/>
              <stop offset="100%" stop-color="#051e24"/>
            </linearGradient>
            <filter id="neonGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="#22C55E" flood-opacity="0.9"/>
            </filter>
            <filter id="titleShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="4" dy="8" stdDeviation="6" flood-color="#000000" flood-opacity="0.9"/>
            </filter>
          </defs>

          <rect width="${width}" height="${height}" fill="url(#darkBg)"/>
          <line x1="0" y1="180" x2="1280" y2="180" stroke="#1f2937" stroke-width="2"/>
          <line x1="0" y1="360" x2="1280" y2="360" stroke="#1f2937" stroke-width="2"/>
          <line x1="0" y1="540" x2="1280" y2="540" stroke="#1f2937" stroke-width="2"/>
          
          <line x1="800" y1="300" x2="800" y2="500" stroke="#EF4444" stroke-width="4"/>
          <rect x="780" y="340" width="40" height="120" rx="4" fill="#EF4444"/>
          <line x1="880" y1="220" x2="880" y2="450" stroke="#22C55E" stroke-width="4"/>
          <rect x="860" y="260" width="40" height="140" rx="4" fill="#22C55E"/>
          <line x1="960" y1="160" x2="960" y2="380" stroke="#22C55E" stroke-width="4"/>
          <rect x="940" y="200" width="40" height="150" rx="4" fill="#22C55E"/>
          <line x1="1040" y1="80" x2="1040" y2="280" stroke="#22C55E" stroke-width="6" filter="url(#neonGlow)"/>
          <rect x="1015" y="120" width="50" height="130" rx="4" fill="#22C55E" filter="url(#neonGlow)"/>
          <path d="M 740 380 Q 900 240 1060 110" fill="none" stroke="#FACC15" stroke-width="8" stroke-dasharray="12,8"/>

          <rect x="60" y="60" width="380" height="70" rx="18" fill="#16A34A" filter="url(#titleShadow)"/>
          <text x="250" y="110" font-family="Impact, Arial Black, sans-serif" font-size="38" font-weight="900" fill="#FFFFFF" text-anchor="middle">📈 95% WIN RATE</text>

          <text x="60" y="260" font-family="Impact, Arial Black, sans-serif" font-size="92" font-weight="900" fill="#FACC15" stroke="#000000" stroke-width="12" paint-order="stroke fill" filter="url(#titleShadow)">SECRET ENTRY</text>
          <text x="60" y="370" font-family="Impact, Arial Black, sans-serif" font-size="86" font-weight="900" fill="#FFFFFF" stroke="#000000" stroke-width="12" paint-order="stroke fill" filter="url(#titleShadow)">STRATEGY 🚀</text>

          <rect x="60" y="460" width="440" height="90" rx="20" fill="#2563EB" stroke="#FFFFFF" stroke-width="4" filter="url(#titleShadow)"/>
          <text x="280" y="522" font-family="Impact, Arial Black, sans-serif" font-size="44" font-weight="900" fill="#FFFFFF" text-anchor="middle">🎯 1:3 RISK REWARD</text>
        </svg>
      `);
      await sharp(tradingSvg).png().toFile(outputPath);
      return outputPath;
    }

    // Category-themed cinematic thumbnail — the background matches the
    // video's topic (space ≠ classroom) and the visual style.
    const theme = this.categoryThumbTheme(concept.categoryId, concept.visualStyle);

    try {
      const bgBuffer = await sharp(Buffer.from(theme.svg(width, height))).png().toBuffer();

      const isCartoon = String(concept.visualStyle || '').includes('cartoon');
      let heroBuffer = null;
      if (isCartoon) {
        try {
          const heroPath = path.join(__dirname, '..', 'assets', 'characters', 'hero_shocked.png');
          heroBuffer = await sharp(heroPath).resize(540, 540, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
        } catch (e) {
          heroBuffer = null;
        }
      }

      const titleClean = String(concept.primaryText || concept.title || 'MUST WATCH').toUpperCase().slice(0, 20);
      const subClean = String(concept.secondaryText || 'MUST WATCH').toUpperCase().slice(0, 24);

      const titleSvg = Buffer.from(`
        <svg width="${width}" height="${height}">
          <defs>
            <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="4" dy="8" stdDeviation="6" flood-color="#000000" flood-opacity="0.9"/>
            </filter>
            <linearGradient id="yellowGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#FFF500"/>
              <stop offset="100%" stop-color="#FF9900"/>
            </linearGradient>
          </defs>

          <!-- Top Badge (topic-specific) -->
          <rect x="50" y="60" width="430" height="65" rx="15" fill="${theme.badgeColor}" filter="url(#shadow)"/>
          <text x="265" y="105" font-family="Impact, Arial Black, sans-serif" font-size="34" font-weight="900" fill="#FFFFFF" text-anchor="middle">${theme.badge}</text>

          <!-- Main Catchy Title -->
          <text x="60" y="260" font-family="Impact, Arial Black, sans-serif" font-size="92" font-weight="900" fill="url(#yellowGrad)" stroke="#000000" stroke-width="12" paint-order="stroke fill" filter="url(#shadow)">${titleClean}!</text>
          <text x="60" y="370" font-family="Impact, Arial Black, sans-serif" font-size="74" font-weight="900" fill="#FFFFFF" stroke="#000000" stroke-width="10" paint-order="stroke fill" filter="url(#shadow)">${subClean}</text>
          
          <!-- Bottom Punchline Hook (topic-specific) -->
          <rect x="50" y="460" width="500" height="80" rx="20" fill="${theme.punchBg}" stroke="#000000" stroke-width="6" filter="url(#shadow)"/>
          <text x="300" y="518" font-family="Impact, Arial Black, sans-serif" font-size="38" font-weight="900" fill="#FFFFFF" text-anchor="middle">${theme.punchline}</text>
        </svg>
      `);

      const composites = [
        ...(heroBuffer ? [{ input: heroBuffer, top: 120, left: 720 }] : []),
        { input: titleSvg, top: 0, left: 0 }
      ];

      await sharp(bgBuffer)
        .composite(composites)
        .png()
        .toFile(outputPath);

      return outputPath;
    } catch (err) {
      this.logger.warn(`Pro thumbnail composite fallback: ${err.message}`);
      const fallbackSvg = `
        <svg width="${width}" height="${height}">
          <rect width="${width}" height="${height}" fill="#1e1b4b"/>
          <text x="640" y="360" font-family="Arial, sans-serif" font-size="64" font-weight="bold" fill="#ffffff" text-anchor="middle">${concept.title || 'VIRAL STORY'}</text>
        </svg>
      `;
      await sharp(Buffer.from(fallbackSvg)).png().toFile(outputPath);
      return outputPath;
    }
  }

  /**
   * Category-themed thumbnail art: gradient scene + topic-specific badge and
   * punchline text, so a space video never ships with school-hall art again.
   */
  categoryThumbTheme(categoryId, _visualStyle) {
    const themes = {
      space: {
        badge: '🌌 SPACE MYSTERY', badgeColor: '#4C1D95',
        punchline: 'THE UNIVERSE IS BIGGER', punchBg: '#1E1B4B',
        scene: (w, h) => {
          let stars = '';
          for (let i = 0; i < 110; i++) {
            const x = ((Math.sin(i * 127.1) * 43758.5453) % 1 + 1) % 1 * w;
            const y = ((Math.sin(i * 311.7) * 12543.21) % 1 + 1) % 1 * h;
            const r = 1 + (((Math.sin(i * 74.7) * 9631.13) % 1 + 1) % 1) * 3;
            stars += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="#fff" opacity="0.8"/>`;
          }
          return `
            <defs><radialGradient id="g" cx="30%" cy="25%"><stop offset="0%" stop-color="#312e81"/><stop offset="60%" stop-color="#1e1b4b"/><stop offset="100%" stop-color="#020617"/></radialGradient></defs>
            <rect width="${w}" height="${h}" fill="url(#g)"/>
            <ellipse cx="${w * 0.62}" cy="${h * 0.72}" rx="${w * 0.42}" ry="${h * 0.2}" fill="#8b5cf6" opacity="0.22"/>
            <circle cx="${w * 0.72}" cy="${h * 0.34}" r="${h * 0.16}" fill="#7c3aed" opacity="0.85"/>
            <ellipse cx="${w * 0.72}" cy="${h * 0.34}" rx="${h * 0.24}" ry="${h * 0.06}" fill="none" stroke="#c4b5fd" stroke-width="10" opacity="0.8" transform="rotate(-18 ${w * 0.72} ${h * 0.34})"/>
            ${stars}`;
        }
      },
      'future-ai': {
        badge: '🤖 AI REVEALS', badgeColor: '#0E7490',
        punchline: 'THE FUTURE IS HERE', punchBg: '#082F49',
        scene: (w, h) => {
          let grid = '';
          const horizon = h * 0.62;
          for (let i = 1; i <= 8; i++) {
            const y = horizon + Math.pow(i / 8, 2.1) * (h - horizon);
            grid += `<line x1="0" y1="${y.toFixed(0)}" x2="${w}" y2="${y.toFixed(0)}" stroke="#22d3ee" stroke-width="2" opacity="0.35"/>`;
          }
          for (let i = -6; i <= 6; i++) {
            grid += `<line x1="${w / 2 + i * w * 0.03}" y1="${horizon}" x2="${w / 2 + i * w * 0.2}" y2="${h}" stroke="#22d3ee" stroke-width="2" opacity="0.3"/>`;
          }
          return `
            <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#082f49"/><stop offset="100%" stop-color="#020617"/></linearGradient></defs>
            <rect width="${w}" height="${h}" fill="url(#g)"/>
            <circle cx="${w * 0.5}" cy="${h * 0.3}" r="${h * 0.14}" fill="none" stroke="#22d3ee" stroke-width="8" opacity="0.9"/>
            <circle cx="${w * 0.5}" cy="${h * 0.3}" r="${h * 0.08}" fill="#22d3ee" opacity="0.35"/>
            <rect x="0" y="${horizon - 3}" width="${w}" height="6" fill="#22d3ee" opacity="0.8"/>
            ${grid}`;
        }
      },
      'dark-psychology': {
        badge: '🧠 PSYCHOLOGY FACT', badgeColor: '#86198F',
        punchline: 'YOUR BRAIN LIES TO YOU', punchBg: '#4C1D95',
        scene: (w, h) => `
          <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#312e81"/><stop offset="55%" stop-color="#701a75"/><stop offset="100%" stop-color="#111827"/></linearGradient></defs>
          <rect width="${w}" height="${h}" fill="url(#g)"/>
          <circle cx="${w * 0.68}" cy="${h * 0.36}" r="${h * 0.17}" fill="#e879f9" opacity="0.3"/>
          <circle cx="${w * 0.68}" cy="${h * 0.36}" r="${h * 0.12}" fill="#e879f9" opacity="0.35"/>
          <circle cx="${w * 0.68}" cy="${h * 0.36}" r="${h * 0.07}" fill="#f0abfc" opacity="0.6"/>`,
      },
      'history-what-if': {
        badge: '⏳ WHAT IF…', badgeColor: '#B45309',
        punchline: 'HISTORY REWRITTEN', punchBg: '#78350F',
        scene: (w, h) => `
          <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#b45309"/><stop offset="100%" stop-color="#1c1917"/></linearGradient></defs>
          <rect width="${w}" height="${h}" fill="url(#g)"/>
          <circle cx="${w * 0.7}" cy="${h * 0.28}" r="${h * 0.12}" fill="#fde68a" opacity="0.9"/>
          <path d="M0 ${h * 0.72} Q ${w * 0.3} ${h * 0.56} ${w * 0.62} ${h * 0.74} T ${w} ${h * 0.7} V ${h} H 0 Z" fill="#451a03" opacity="0.9"/>
          <rect x="${w * 0.16}" y="${h * 0.42}" width="${w * 0.1}" height="${h * 0.34}" fill="#292524" opacity="0.9"/>
          <rect x="${w * 0.3}" y="${h * 0.5}" width="${w * 0.08}" height="${h * 0.26}" fill="#292524" opacity="0.85"/>`,
      },
      survival: {
        badge: '🧭 SURVIVAL MODE', badgeColor: '#065F46',
        punchline: 'WOULD YOU SURVIVE?', punchBg: '#022C22',
        scene: (w, h) => `
          <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#065f46"/><stop offset="100%" stop-color="#022c22"/></linearGradient></defs>
          <rect width="${w}" height="${h}" fill="url(#g)"/>
          <polygon points="0,${h} ${w * 0.18},${h * 0.42} ${w * 0.36},${h}" fill="#064e3b" opacity="0.9"/>
          <polygon points="${w * 0.22},${h} ${w * 0.5},${h * 0.3} ${w * 0.82},${h}" fill="#065f46" opacity="0.85"/>
          <polygon points="${w * 0.6},${h} ${w * 0.84},${h * 0.4} ${w},${h}" fill="#022c22"/>
          <circle cx="${w * 0.3}" cy="${h * 0.2}" r="${h * 0.09}" fill="#fde68a" opacity="0.8"/>`,
      },
      default: {
        badge: '🔥 MUST WATCH', badgeColor: '#DC2626',
        punchline: 'WATCH TILL THE END', punchBg: '#7F1D1D',
        scene: (w, h) => `
          <defs><radialGradient id="g" cx="35%" cy="30%"><stop offset="0%" stop-color="#3730a3"/><stop offset="100%" stop-color="#020617"/></radialGradient></defs>
          <rect width="${w}" height="${h}" fill="url(#g)"/>
          <circle cx="${w * 0.7}" cy="${h * 0.4}" r="${h * 0.16}" fill="#818cf8" opacity="0.3"/>
          <circle cx="${w * 0.7}" cy="${h * 0.4}" r="${h * 0.1}" fill="#38bdf8" opacity="0.4"/>`
      }
    };
    const theme = themes[categoryId] || themes.default;
    return { ...theme, svg: theme.scene };
  }

  hexToRgb(color) {
    const colors = {
      'blue': '#0066CC',
      'red': '#CC0000',
      'green': '#00CC66',
      'yellow': '#FFCC00',
      'purple': '#6600CC',
      'orange': '#FF6600',
      'white': '#FFFFFF',
      'black': '#000000',
      'gray': '#808080',
      'dark blue': '#003366',
      'gold': '#FFD700'
    };
    return colors[color] || '#000000';
  }

  async addTextOverlay(imagePath, _concept) {
    return imagePath;
  }

  async optimizeForYouTube(imagePath) {
    const outputPath = path.join(__dirname, '..', 'uploads', 'thumbnails', `thumbnail_optimized_${Date.now()}.jpg`);
    
    // YouTube optimization: JPEG format, proper compression
    await sharp(imagePath)
      .resize(1280, 720, {
        fit: 'cover',
        position: 'centre'
      })
      .jpeg({
        quality: 90,
        progressive: true,
        optimizeScans: true
      })
      .toFile(outputPath);
    
    // Verify file size (YouTube limit is 2MB)
    const stats = await fs.stat(outputPath);
    if (stats.size > 2 * 1024 * 1024) {
      // Re-compress if too large
      await sharp(imagePath)
        .resize(1280, 720)
        .jpeg({ quality: 80 })
        .toFile(outputPath);
    }
    
    return outputPath;
  }

  async getFileSize(filePath) {
    const stats = await fs.stat(filePath);
    return stats.size;
  }

  async generateABVariants(concept) {
    // Generate multiple thumbnail variants for A/B testing
    const variants = [];
    
    // Variant 1: Different color scheme
    const variant1 = { ...concept };
    variant1.colors = {
      primary: concept.colors.secondary,
      secondary: concept.colors.primary,
      accent: concept.colors.accent
    };
    variants.push(await this.createThumbnail(variant1));
    
    // Variant 2: Different text
    const variant2 = { ...concept };
    variant2.primaryText = this.generateAlternativeText(concept.primaryText);
    variants.push(await this.createThumbnail(variant2));
    
    // Variant 3: Different composition
    const variant3 = { ...concept };
    variant3.composition = 'centered';
    variants.push(await this.createThumbnail(variant3));
    
    return variants;
  }

  generateAlternativeText(originalText) {
    const alternatives = {
      'HOW': 'WHY',
      'BEST': 'TOP',
      'GUIDE': 'SECRETS',
      'TRUTH': 'FACTS',
      'ULTIMATE': 'COMPLETE'
    };
    
    return alternatives[originalText] || originalText + '!';
  }
}

module.exports = { ThumbnailDesignerAgent };