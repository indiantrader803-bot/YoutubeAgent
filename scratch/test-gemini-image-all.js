const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });

const prompt = 'Create a thumbnail image for a video titled "How to Read Anyone Instantly: 5 Deep Psychology Tricks". The image should show a mysterious silhouette of a person looking at eye contact, warm dramatic lighting, 16:9 aspect ratio, high quality digital art.';

async function testModel(model) {
  try {
    console.log(`Testing ${model}...`);
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });
    console.log(`SUCCESS with ${model}!`);
    return true;
  } catch (error) {
    console.log(`FAILED with ${model}:`, error.message);
    return false;
  }
}

async function main() {
  await testModel('gemini-2.5-flash-image');
  await testModel('gemini-3.1-flash-lite-image');
  await testModel('gemini-3-pro-image-preview');
  await testModel('gemini-3-pro-image');
}

main();
