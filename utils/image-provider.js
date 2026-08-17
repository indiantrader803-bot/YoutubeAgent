const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { detectHardware } = require('./dependency-manager');

class ImageProvider {
  constructor(options = {}) {
    this.comfyUrl = options.comfyUrl || process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
    this.provider = options.provider || process.env.IMAGE_PROVIDER || 'comfyui';
    this.hardware = detectHardware();
  }

  async generate(prompt, imagePath) {
    await fs.mkdir(path.dirname(imagePath), { recursive: true });

    // Try ComfyUI if hardware VRAM >= 6GB or explicitly enabled
    if (this.hardware.vramGb >= 6 || this.provider === 'comfyui') {
      try {
        if (await this.health_check()) {
          return await this.generateComfyUI(prompt, imagePath);
        }
      } catch (err) {
        console.warn(`[ImageProvider] ComfyUI local image generation unavailable (${err.message}). Using visual stock media fallback.`);
      }
    }

    // Fallback: Stock / Free Visual Canvas API
    return await this.generateStockFallback(prompt, imagePath);
  }

  async generate_batch(prompts, outputDir) {
    await fs.mkdir(outputDir, { recursive: true });
    const results = [];
    for (let i = 0; i < prompts.length; i++) {
      const imgPath = path.join(outputDir, `image_${i}.png`);
      const img = await this.generate(prompts[i], imgPath);
      results.push(img);
    }
    return results;
  }

  async generateComfyUI(prompt, imagePath) {
    const workflow = {
      "3": {
        "inputs": {
          "seed": Math.floor(Math.random() * 1000000),
          "steps": 20,
          "cfg": 7,
          "sampler_name": "euler",
          "scheduler": "normal",
          "denoise": 1,
          "model": ["4", 0],
          "positive": ["6", 0],
          "negative": ["7", 0],
          "latent_image": ["5", 0]
        },
        "class_type": "KSampler"
      },
      "4": { "inputs": { "ckpt_name": "v1-5-pruned-emaonly.safetensors" }, "class_type": "CheckpointLoaderSimple" },
      "5": { "inputs": { "width": 1280, "height": 720, "batch_size": 1 }, "class_type": "EmptyLatentImage" },
      "6": { "inputs": { "text": prompt }, "class_type": "CLIPTextEncode" },
      "7": { "inputs": { "text": "ugly, blurry, low resolution, bad quality" }, "class_type": "CLIPTextEncode" },
      "8": { "inputs": { "samples": ["3", 0], "vae": ["4", 2] }, "class_type": "VAEDecode" },
      "9": { "inputs": { "filename_prefix": "YoutubeAgent", "images": ["8", 0] }, "class_type": "SaveImage" }
    };

    const res = await axios.post(`${this.comfyUrl}/prompt`, { prompt: workflow });
    const promptId = res.data.prompt_id;

    // Poll for completion
    let filename = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const history = await axios.get(`${this.comfyUrl}/history/${promptId}`);
      if (history.data[promptId] && history.data[promptId].outputs) {
        const outputs = history.data[promptId].outputs["9"];
        if (outputs && outputs.images && outputs.images.length > 0) {
          filename = outputs.images[0].filename;
          break;
        }
      }
    }

    if (!filename) throw new Error('ComfyUI generation timed out');

    const imgRes = await axios.get(`${this.comfyUrl}/view?filename=${filename}`, { responseType: 'arraybuffer' });
    await fs.writeFile(imagePath, Buffer.from(imgRes.data));
    return imagePath;
  }

  async generateStockFallback(prompt, imagePath) {
    const encodedPrompt = encodeURIComponent(`${prompt}, 4k ultra detailed cinematic visual wallpaper`);
    const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1280&height=720&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;

    try {
      const response = await axios({
        method: 'GET',
        url: pollinationsUrl,
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      await fs.writeFile(imagePath, Buffer.from(response.data));
      return imagePath;
    } catch (e) {
      // High-contrast SVG banner rendering fallback
      const titleText = prompt.slice(0, 45).replace(/'/g, "&apos;");
      const svg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
        <rect width="1280" height="720" fill="#0f172a"/>
        <text x="640" y="340" font-family="Arial" font-size="44" font-weight="bold" fill="#ffffff" text-anchor="middle">${titleText}</text>
      </svg>`;
      const sharp = require('sharp');
      await sharp(Buffer.from(svg)).png().toFile(imagePath);
      return imagePath;
    }
  }

  async health_check() {
    try {
      const res = await axios.get(`${this.comfyUrl}/system_stats`, { timeout: 2000 });
      return res.status === 200;
    } catch (e) {
      return false;
    }
  }
}

module.exports = { ImageProvider };
