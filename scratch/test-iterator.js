const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });

async function main() {
  try {
    const response = await ai.models.list();
    console.log("Trying for await...");
    for await (const m of response) {
      console.log(m.name);
    }
  } catch (err) {
    console.error("for await failed:", err.message);
  }
}

main();
