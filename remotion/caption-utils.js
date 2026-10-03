// Caption utilities shared by every Remotion composition.
//
// The old renderer dumped an ENTIRE scene's narration (often 300+ characters)
// into one giant centered box that covered the screen. These helpers split
// narration into short, subtitle-sized chunks and time-slice them across the
// scene so viewers always see exactly ONE slim line at the bottom — the way
// human-edited videos do it.

const MAX_WORDS = 7;
const MAX_CHARS = 46;

/**
 * Split narration text into short caption chunks (one spoken breath each).
 * Splits on sentence boundaries first, then groups words so no chunk exceeds
 * `maxWords` words or `maxChars` characters.
 */
export function buildCaptionChunks(text, { maxWords = MAX_WORDS, maxChars = MAX_CHARS } = {}) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];

  const chunks = [];
  // Sentence / clause boundaries keep captions aligned with natural speech.
  const clauses = clean.split(/(?<=[.!?…:])\s+|,\s+(?=(?:and|but|so|because|which|that|while|when)\b)/i);

  for (const clause of clauses) {
    const words = clause.trim().split(' ').filter(Boolean);
    if (words.length === 0) continue;

    let current = [];
    for (const word of words) {
      const candidate = [...current, word].join(' ');
      if (current.length > 0 && (current.length + 1 > maxWords || candidate.length > maxChars)) {
        chunks.push(current.join(' '));
        current = [word];
      } else {
        current.push(word);
      }
    }
    if (current.length > 0) chunks.push(current.join(' '));
  }

  return chunks.length > 0 ? chunks : [clean.slice(0, maxChars)];
}

/**
 * Which caption chunk is "on screen" at a given frame inside the scene.
 * Chunks are shown for equal time slices of the scene duration.
 */
export function activeCaptionChunk(chunks, frameInScene, sceneDurationInFrames) {
  if (!chunks || chunks.length === 0) return '';
  if (chunks.length === 1) return chunks[0];
  const total = Math.max(1, sceneDurationInFrames || 1);
  const clamped = Math.max(0, Math.min(frameInScene || 0, total - 1));
  const index = Math.min(chunks.length - 1, Math.floor((clamped / total) * chunks.length));
  return chunks[index];
}
