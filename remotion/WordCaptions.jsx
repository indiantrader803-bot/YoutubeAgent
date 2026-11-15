import React from 'react';
import { useCurrentFrame, useVideoConfig, spring } from 'remotion';
import { buildCaptionChunks } from './caption-utils';

/**
 * Word-by-word highlighted captions. One short chunk at a time at the bottom;
 * the currently "spoken" word pops in yellow, earlier words stay white.
 * Word timing is estimated from each word's share of the scene duration.
 */
export const WordCaptions = ({ text = '', sceneDurationInFrames = 90, isShort = false, accent = '#38bdf8' }) => {
  const frame = useCurrentFrame(); // local to the scene Sequence
  const { fps } = useVideoConfig();

  const chunks = buildCaptionChunks(text);
  if (chunks.length === 0) return null;

  const weights = chunks.map((c) => Math.max(1, c.length));
  const totalW = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  let idx = chunks.length - 1;
  let chunkStart = 0;
  let chunkLen = sceneDurationInFrames;
  for (let i = 0; i < chunks.length; i++) {
    const len = (weights[i] / totalW) * sceneDurationInFrames;
    if (frame < acc + len) {
      idx = i;
      chunkStart = acc;
      chunkLen = len;
      break;
    }
    acc += len;
  }
  if (idx === chunks.length - 1 && frame >= acc) {
    chunkStart = acc - ((weights[idx] / totalW) * sceneDurationInFrames);
    chunkLen = (weights[idx] / totalW) * sceneDurationInFrames;
  }

  const words = chunks[idx].split(' ');
  const progress = Math.max(0, Math.min(0.999, (frame - chunkStart) / Math.max(1, chunkLen)));
  const activeWord = Math.floor(progress * words.length);

  const pop = spring({ frame: Math.max(0, frame - chunkStart), fps, config: { damping: 12, stiffness: 260 } });
  const fontSize = chunks[idx].length > 38 ? (isShort ? 54 : 42) : isShort ? 64 : 50;

  return (
    <div
      style={{
        position: 'absolute',
        ...(isShort ? { top: '44%' } : { bottom: 56 }),
        left: '50%',
        transform: `translate(-50%, ${isShort ? '-50%' : '0'}) scale(${0.92 + 0.08 * Math.min(1, pop)})`,
        maxWidth: isShort ? '92%' : '80%',
        zIndex: 35,
        textAlign: 'center',
        pointerEvents: 'none'
      }}
    >
      <div
        style={{
          display: 'inline-block',
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.88) 0%, rgba(2, 6, 23, 0.94) 100%)',
          borderRadius: 22,
          padding: isShort ? '16px 30px' : '14px 28px',
          border: '1.5px solid rgba(255, 255, 255, 0.14)',
          borderBottom: `5px solid ${accent}`,
          boxShadow: `0 14px 35px rgba(0,0,0,0.7), 0 0 25px ${accent}33`,
          backdropFilter: 'blur(10px)'
        }}
      >
        {words.map((w, i) => {
          const isActive = i === activeWord;
          return (
            <span
              key={`${idx}-${i}`}
              style={{
                fontFamily: '"Montserrat", "Inter", system-ui, -apple-system, sans-serif',
                fontWeight: 900,
                fontSize,
                lineHeight: 1.22,
                margin: '0 0.18em',
                display: 'inline-block',
                textTransform: 'uppercase',
                letterSpacing: '0.02em',
                color: isActive ? '#FFE600' : '#FFFFFF',
                transform: isActive ? 'scale(1.18) translateY(-2px)' : 'scale(1)',
                transition: 'transform 0.12s ease-out, color 0.12s ease-out',
                textShadow: isActive
                  ? '0 0 16px rgba(255, 230, 0, 0.8), 0 4px 10px rgba(0, 0, 0, 0.9)'
                  : '0 3px 8px rgba(0, 0, 0, 0.85)'
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </div>
  );
};
