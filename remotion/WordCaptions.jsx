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

  const pop = spring({ frame: Math.max(0, frame - chunkStart), fps, config: { damping: 13, stiffness: 240 } });
  const fontSize = chunks[idx].length > 38 ? (isShort ? 50 : 40) : isShort ? 58 : 46;

  return (
    <div
      style={{
        position: 'absolute',
        ...(isShort ? { top: '43%' } : { bottom: 52 }),
        left: '50%',
        transform: `translate(-50%, ${isShort ? '-50%' : '0'}) scale(${0.9 + 0.1 * Math.min(1, pop)})`,
        maxWidth: isShort ? '90%' : '76%',
        zIndex: 30,
        textAlign: 'center'
      }}
    >
      <div
        style={{
          display: 'inline-block',
          background: 'rgba(2, 6, 23, 0.66)',
          borderRadius: 18,
          padding: isShort ? '14px 26px' : '11px 24px',
          borderBottom: `4px solid ${accent}`,
          boxShadow: '0 8px 22px rgba(0,0,0,0.5)'
        }}
      >
        {words.map((w, i) => (
          <span
            key={`${idx}-${i}`}
            style={{
              fontFamily: 'system-ui, "Segoe UI", "DejaVu Sans", Arial, sans-serif',
              fontWeight: 800,
              fontSize,
              lineHeight: 1.18,
              margin: '0 0.18em',
              display: 'inline-block',
              color: i === activeWord ? '#fde047' : '#ffffff',
              transform: i === activeWord ? 'scale(1.08)' : 'scale(1)',
              textShadow: '0 3px 8px rgba(0,0,0,0.85)'
            }}
          >
            {w}
          </span>
        ))}
      </div>
    </div>
  );
};
