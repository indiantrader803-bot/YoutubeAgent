const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });

async function main() {
  const response = await ai.models.list();
  console.log("Response keys:", Object.keys(response));
  console.log("Is array?", Array.isArray(response));
  if (response.models) {
    console.log("response.models is defined, keys:", Object.keys(response.models));
  }
}

main();
