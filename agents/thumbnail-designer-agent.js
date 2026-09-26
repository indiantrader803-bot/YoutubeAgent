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

    // Pro 2D Cartoon Storytime Thumbnail with Character Sprite
    const bgPath = path.join(__dirname, '..', 'assets', 'backgrounds', 'classroom.png');
    const heroPath = path.join(__dirname, '..', 'assets', 'characters', 'hero_shocked.png');

    try {
      const bgBuffer = await sharp(bgPath).resize(width, height, { fit: 'cover' }).toBuffer();
      const heroBuffer = await sharp(heroPath).resize(540, 540, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();

      const titleClean = String(concept.primaryText || 'SURPRISE TEST').toUpperCase().slice(0, 20);
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

          <!-- Top Badge -->
          <rect x="50" y="60" width="380" height="65" rx="15" fill="#E11D48" filter="url(#shadow)"/>
          <text x="240" y="105" font-family="Impact, Arial Black, sans-serif" font-size="36" font-weight="900" fill="#FFFFFF" text-anchor="middle">🔥 100% RELATABLE</text>

          <!-- Main Catchy Title -->
          <text x="60" y="260" font-family="Impact, Arial Black, sans-serif" font-size="92" font-weight="900" fill="url(#yellowGrad)" stroke="#000000" stroke-width="12" paint-order="stroke fill" filter="url(#shadow)">${titleClean}!</text>
          <text x="60" y="370" font-family="Impact, Arial Black, sans-serif" font-size="78" font-weight="900" fill="#FFFFFF" stroke="#000000" stroke-width="10" paint-order="stroke fill" filter="url(#shadow)">${subClean} 😂</text>
          
          <!-- Bottom Punchline Hook -->
          <rect x="50" y="460" width="460" height="80" rx="20" fill="#FACC15" stroke="#000000" stroke-width="6" filter="url(#shadow)"/>
          <text x="280" y="518" font-family="Impact, Arial Black, sans-serif" font-size="40" font-weight="900" fill="#000000" text-anchor="middle">BACKBENCHER HACK 😱</text>
        </svg>
      `);

      await sharp(bgBuffer)
        .composite([
          { input: heroBuffer, top: 120, left: 720 },
          { input: titleSvg, top: 0, left: 0 }
        ])
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