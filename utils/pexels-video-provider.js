const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Logger } = require('./logger');

class PexelsVideoProvider {
  constructor(apiKey) {
    this.logger = new Logger('PexelsVideoProvider');
    this.apiKey = apiKey || process.env.PEXELS_API_KEY;
    this.baseUrl = 'https://api.pexels.com/videos';
    this.usedVideoIds = new Set();
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  /**
   * Search for videos on Pexels
   */
  async searchVideos(query, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('Pexels API key not configured');
    }

    const {
      orientation = 'landscape',
      size = 'medium',
      perPage = 10,
      page = 1
    } = options;

    try {
      const response = await axios.get(`${this.baseUrl}/search`, {
        params: {
          query: query.trim(),
          orientation,
          size,
          per_page: perPage,
          page
        },
        headers: {
          'Authorization': this.apiKey,
          'User-Agent': 'YouTube-Automation-Agent/2.4'
        },
        timeout: 15000
      });

      return response.data?.videos || [];
    } catch (error) {
      this.logger.warn(`Pexels video search failed for query "${query}": ${error.response?.data?.error || error.message}`);
      return [];
    }
  }

  /**
   * Select the best video file (prefer MP4, 1080p or 720p HD)
   */
  selectBestVideoFile(video, isPortrait = false) {
    if (!video || !video.video_files || video.video_files.length === 0) {
      return null;
    }

    const mp4Files = video.video_files.filter(f =>
      f.file_type === 'video/mp4' || (f.link && f.link.includes('.mp4'))
    );

    const candidates = mp4Files.length > 0 ? mp4Files : video.video_files;

    if (isPortrait) {
      const portraitFiles = candidates.filter(f => f.height >= f.width);
      if (portraitFiles.length > 0) {
        const sorted = portraitFiles.sort((a, b) => (b.width * b.height) - (a.width * a.height));
        return sorted[0];
      }
    }

    // Prefer HD files (width ~ 1920 or 1280)
    const hdFiles = candidates.filter(f => f.quality === 'hd' && f.width >= 1280 && f.width <= 1920);
    if (hdFiles.length > 0) {
      return hdFiles[0];
    }

    // Fallback: sort by resolution descending, pick closest to 1080p
    const sorted = candidates.sort((a, b) => {
      const diffA = Math.abs((a.width || 0) - 1920);
      const diffB = Math.abs((b.width || 0) - 1920);
      return diffA - diffB;
    });

    return sorted[0] || video.video_files[0];
  }

  /**
   * Download a video file from direct URL to local path
   */
  async downloadVideo(url, outputPath) {
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(outputPath));
      writer.on('error', reject);
    });
  }

  /**
   * Extract visual search keywords from section title and text
   */
  extractKeywords(section, defaultTopic = 'technology') {
    const rawText = [
      section.title || '',
      Array.isArray(section.content) ? section.content.join(' ') : (section.content || ''),
      section.narration || ''
    ].join(' ');

    const stopWords = new Set([
      'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'more',
      'will', 'your', 'about', 'what', 'when', 'which', 'their', 'there',
      'into', 'these', 'could', 'other', 'than', 'then', 'also', 'some',
      'section', 'step', 'welcome', 'subscribe', 'today', 'deep', 'dive',
      'hello', 'thanks', 'watching', 'intro', 'introduction', 'conclusion',
      'overview', 'summary', 'takeaways', 'next', 'steps'
    ]);

    const words = rawText
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    if (words.length === 0) {
      return defaultTopic;
    }

    const uniqueWords = [...new Set(words)];
    return uniqueWords.slice(0, 3).join(' ');
  }

  /**
   * Fetch and download an HD stock video clip for a given section
   */
  async fetchVideoForSection(section, index, outputDir, options = {}) {
    const isPortrait = Boolean(options.isShort);
    const orientation = isPortrait ? 'portrait' : 'landscape';
    const defaultTopic = options.topic || 'technology';

    const primaryQuery = this.extractKeywords(section, defaultTopic);
    const fallbackQueries = [
      primaryQuery,
      section.title ? section.title.replace(/[^a-zA-Z0-9 ]/g, ' ').trim() : defaultTopic,
      `${defaultTopic} cinematic`,
      'abstract digital technology',
      'cinematic timelapse'
    ];

    let chosenVideo = null;
    let chosenFile = null;

    for (const query of fallbackQueries) {
      if (!query || query.trim().length === 0) continue;
      this.logger.info(`Searching Pexels video clip for section ${index + 1} with query: "${query}"`);
      const videos = await this.searchVideos(query, {
        orientation,
        perPage: 15
      });

      const availableVideos = videos.filter(v => !this.usedVideoIds.has(v.id));
      const pool = availableVideos.length > 0 ? availableVideos : videos;

      if (pool.length > 0) {
        for (const video of pool) {
          const file = this.selectBestVideoFile(video, isPortrait);
          if (file && file.link) {
            chosenVideo = video;
            chosenFile = file;
            this.usedVideoIds.add(video.id);
            break;
          }
        }
      }

      if (chosenFile) break;
    }

    if (!chosenFile) {
      this.logger.warn(`No stock video found on Pexels for section ${index + 1}`);
      return null;
    }

    const clipFileName = `section_clip_${index}_${chosenVideo.id}.mp4`;
    const clipPath = path.join(outputDir, clipFileName);

    this.logger.info(`Downloading Pexels clip for section ${index + 1} (${chosenFile.quality || 'HD'}, ${chosenFile.width}x${chosenFile.height}): ${clipFileName}`);
    await this.downloadVideo(chosenFile.link, clipPath);

    return {
      clipPath,
      videoId: chosenVideo.id,
      duration: chosenVideo.duration || 10,
      width: chosenFile.width,
      height: chosenFile.height
    };
  }
}

module.exports = { PexelsVideoProvider };
