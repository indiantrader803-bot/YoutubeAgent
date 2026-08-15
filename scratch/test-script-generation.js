const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });

const prompt = `You are writing a YouTube script plan.
Return only valid JSON with this exact shape:
{
  "title": "compelling title under 100 characters",
  "hook": "opening hook in one sentence",
  "sections": [
    { "title": "section title", "content": ["spoken script bullet"], "duration": 60 }
  ],
  "cta": "clear call to action"
}

Topic: 5 Deep Psychology Tricks to Read Anyone Instantly
Style/content type: educational
Angle: informative
Target audience: General audience
Desired length: 8-12 minutes
Tone: informative
Pacing: steady
Keywords: psychology, tricks, read anyone, human behavior
Avoid fabricated statistics, unsupported claims, and fake urgency.`;

async function test() {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: { temperature: 0.7 }
    });
    console.log("Raw Response:\n", response.text);
    
    // Test parsing
    const text = String(response.text || '').trim();
    const withoutFences = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    try {
      const parsed = JSON.parse(withoutFences);
      console.log("Successfully parsed JSON directly!");
    } catch (e) {
      console.log("Direct parse failed, trying regex match...");
      const match = withoutFences.match(/\{[\s\S]*\}/);
      if (!match) {
        console.log("Regex match failed entirely!");
      } else {
        try {
          const parsed = JSON.parse(match[0]);
          console.log("Parsed JSON via regex match!");
        } catch (regexErr) {
          console.log("Regex parse failed too:", regexErr.message);
        }
      }
    }
  } catch (error) {
    console.error("Failed:", error.message);
  }
}

test();
