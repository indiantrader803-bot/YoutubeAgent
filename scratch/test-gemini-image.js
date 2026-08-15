const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });

const prompt = 'Create a thumbnail image for a video titled "How to Read Anyone Instantly: 5 Deep Psychology Tricks". The image should show a mysterious silhouette of a person looking at eye contact, warm dramatic lighting, 16:9 aspect ratio, high quality digital art.';

async function test() {
  try {
    console.log("Testing gemini-3.1-flash-image...");
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image',
      contents: prompt,
    });
    
    console.log("Response candidate parts keys:");
    const parts = response.candidates?.[0]?.content?.parts || [];
    console.log("Parts count:", parts.length);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      console.log(`Part ${i}: keys =`, Object.keys(part));
      if (part.inlineData) {
        console.log(`Part ${i} inlineData mimeType:`, part.inlineData.mimeType);
        console.log(`Part ${i} inlineData size (chars):`, part.inlineData.data.length);
      }
    }
  } catch (error) {
    console.error("gemini-3.1-flash-image failed:", error);
  }
}

test();
