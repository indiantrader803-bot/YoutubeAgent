const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });

async function main() {
  try {
    const list = [];
    let pageToken;
    do {
      const response = await ai.models.list({ pageToken, pageSize: 100 });
      for (const m of response.models) {
        if (m.name.includes('imagen') || m.name.includes('image') || m.name.includes('generateImages')) {
          list.push(m);
        }
      }
      pageToken = response.nextPageToken;
    } while (pageToken);

    console.log("Found image-related models:");
    for (const m of list) {
      console.log(`- ${m.name} (${m.displayName}): ${m.supportedActions.join(', ')}`);
    }
  } catch (err) {
    console.error("Failed:", err.message);
  }
}

main();
