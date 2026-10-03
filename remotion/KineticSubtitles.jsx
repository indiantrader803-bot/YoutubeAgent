import React from 'react';
import { useCurrentFrame, spring, useVideoConfig } from 'remotion';
import { buildCaptionChunks, activeCaptionChunk } from './caption-utils';

/**
 * One-line bottom caption bar.
 *
 * Shows exactly ONE short chunk of the scene narration at a time, anchored to
 * the bottom of the frame like real human-made subtitles — never a big
 * centered box covering the video. The pill hugs the text: slim padding,
 * semi-transparent backdrop, subtle accent underline.
 */
export const KineticSubtitles = ({
  text = '',
  frameInScene = 0,
  sceneDurationInFrames = 90,
  isShort = false,
  accent = '#38bdf8'
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const chunks = buildCaptionChunks(text);
  const active = activeCaptionChunk(chunks, frameInScene, sceneDurationInFrames);
  if (!active) return null;

  // Small pop when a new line appears (re-animates on chunk boundaries).
  const chunkKey = Math.floor(((frameInScene || 0) / Math.max(1, sceneDurationInFrames)) * chunks.length);
  const pop = spring({
    frame: Math.min(12, (frameInScene || 0) - chunkKey * Math.ceil(sceneDurationInFrames / chunks.length)),
    fps,
    config: { damping: 14, stiffness: 220 }
  });

  const scale = 0.92 + Math.max(0, Math.min(1, pop)) * 0.08;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: isShort ? '170px' : '46px',
        left: '50%',
        transform: `translateX(-50%) scale(${scale})`,
        zIndex: 20,
        maxWidth: isShort ? '86%' : '78%',
        display: 'flex',
        justifyContent: 'center'
      }}
    >
      <div
        style={{
          background: 'rgba(2, 6, 23, 0.62)',
          backdropFilter: 'blur(6px)',
          borderRadius: '14px',
          padding: isShort ? '10px 22px' : '9px 20px',
          borderBottom: `3px solid ${accent}`,
          boxShadow: '0 6px 18px rgba(0, 0, 0, 0.45)'
        }}
      >
        <span
          style={{
            fontFamily: 'system-ui, "Segoe UI", Arial, sans-serif',
            fontSize: active.length > 40 ? (isShort ? '36px' : '29px') : (isShort ? '42px' : '34px'),
            fontWeight: '700',
            color: '#ffffff',
            whiteSpace: 'nowrap',
            textShadow: '0 2px 6px rgba(0,0,0,0.8)',
            lineHeight: '1.15'
          }}
        >
          {active}
        </span>
      </div>
    </div>
  );
};
