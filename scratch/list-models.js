const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });

async function main() {
  try {
    console.log("Listing available models...");
    const response = await ai.models.list();
    console.log("Response:", JSON.stringify(response, null, 2));
  } catch (err) {
    console.error("List models failed:", err.message);
  }
}

main();
