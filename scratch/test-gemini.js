const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
console.log("Using API Key length:", apiKey ? apiKey.length : 0);
console.log("Using API Key value:", apiKey);

const ai = new GoogleGenAI({ apiKey });

async function test() {
  try {
    console.log("Testing with gemini-2.5-flash...");
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Hello, write a short 3 word sentence.',
    });
    console.log("gemini-2.5-flash response:", response.text);
  } catch (error) {
    console.error("gemini-2.5-flash failed:", error.message);
  }

  try {
    console.log("\nTesting with gemini-2.0-flash...");
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: 'Hello, write a short 3 word sentence.',
    });
    console.log("gemini-2.0-flash response:", response.text);
  } catch (error) {
    console.error("gemini-2.0-flash failed:", error.message);
  }

  try {
    console.log("\nTesting with gemini-1.5-flash...");
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: 'Hello, write a short 3 word sentence.',
    });
    console.log("gemini-1.5-flash response:", response.text);
  } catch (error) {
    console.error("gemini-1.5-flash failed:", error.message);
  }

  try {
    console.log("\nTesting with gemini-3.5-flash (configured in app)...");
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: 'Hello, write a short 3 word sentence.',
    });
    console.log("gemini-3.5-flash response:", response.text);
  } catch (error) {
    console.error("gemini-3.5-flash failed:", error.message);
  }
}

test();
