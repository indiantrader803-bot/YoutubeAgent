const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });

async function test() {
  try {
    console.log("Testing Imagen 3 via generateImages API...");
    const response = await ai.models.generateImages({
      model: 'imagen-3.0-generate-002',
      prompt: 'A dreamy, mystical cosmic background, 16:9, digital art',
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/jpeg',
        aspectRatio: '16:9',
      },
    });

    if (response.generatedImages && response.generatedImages.length > 0) {
      console.log("Success! Imagen 3 generated an image.");
      console.log("Image size (bytes):", response.generatedImages[0].image.imageBytes.length);
    } else {
      console.log("No images returned from Imagen 3.");
    }
  } catch (error) {
    console.error("Imagen 3 failed:", error.message);
  }

  try {
    console.log("\nTesting imagen-3.0-generate-002 via generateContent...");
    const response = await ai.models.generateContent({
      model: 'imagen-3.0-generate-002',
      contents: 'A dreamy mystical cosmic background',
    });
    console.log("generateContent response candidates:", response.candidates?.[0]?.content?.parts);
  } catch (error) {
    console.error("generateContent failed:", error.message);
  }
}

test();
