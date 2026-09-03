import React from 'react';
import { useCurrentFrame, spring, useVideoConfig } from 'remotion';

export const KineticSubtitles = ({ text = '', isShort = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!text || text.trim().length === 0) return null;

  const pop = spring({
    frame: frame % 60,
    fps,
    config: { damping: 12, stiffness: 180 }
  });

  const scale = 0.9 + pop * 0.15;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: isShort ? '220px' : '90px',
        left: '50%',
        transform: `translateX(-50%) scale(${scale})`,
        zIndex: 20,
        maxWidth: isShort ? '90%' : '80%',
        textAlign: 'center',
        padding: '16px 36px',
        background: 'rgba(2, 6, 23, 0.88)',
        borderRadius: '24px',
        border: '3px solid rgba(56, 189, 248, 0.45)',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.65)'
      }}
    >
      <span
        style={{
          fontFamily: 'Impact, "Arial Black", system-ui, sans-serif',
          fontSize: isShort ? '48px' : '44px',
          fontWeight: '900',
          letterSpacing: '1px',
          color: '#ffffff',
          textTransform: 'uppercase',
          textShadow: '3px 3px 0 #000, -3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000',
          lineHeight: '1.2'
        }}
      >
        {text}
      </span>
    </div>
  );
};
