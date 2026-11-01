import React from 'react';
import { useCurrentFrame, useVideoConfig, spring } from 'remotion';

/**
 * Decorative animated "hero object" for the side of the frame the character
 * is NOT on: pulsing concentric rings, a glowing core and orbiting dots.
 * Pure SVG, theme-coloured, loops smoothly.
 */
export const OrbitProp = ({ accent = '#38bdf8', side = 'right' }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const enter = spring({ frame: frame - 6, fps, config: { damping: 14, stiffness: 90 } });
  const size = Math.round(height * 0.5);
  const cx = side === 'right' ? width * 0.72 : width * 0.28;
  const cy = height * 0.42;
  const float = Math.sin(frame * 0.05) * 14;
  const pulse = 1 + Math.sin(frame * 0.09) * 0.05;

  const dots = [0, 1, 2, 3].map((i) => {
    const a = frame * (0.03 + i * 0.012) + i * 1.7;
    const r = 0.22 + i * 0.07;
    return { x: 50 + Math.cos(a) * r * 100, y: 50 + Math.sin(a) * r * 100 * 0.62, s: 2.4 + i * 0.9, i };
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: cx - size / 2,
        top: cy - size / 2 + float,
        width: size,
        height: size,
        opacity: Math.min(1, enter) * 0.9,
        transform: `scale(${Math.min(1, enter) * pulse})`
      }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <radialGradient id="orbCore">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="45%" stopColor={accent} stopOpacity="0.8" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="30" fill="url(#orbCore)" />
        {[18, 30, 42].map((r, i) => (
          <circle
            key={r}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={i === 1 ? '#ffffff' : accent}
            strokeWidth={0.8}
            strokeDasharray={i === 1 ? '2 3' : '8 4'}
            opacity={0.55}
            transform={`rotate(${frame * (i % 2 ? -0.6 : 0.8)} 50 50)`}
          />
        ))}
        {dots.map((d) => (
          <circle key={d.i} cx={d.x} cy={d.y} r={d.s} fill="#ffffff" opacity="0.9" />
        ))}
      </svg>
    </div>
  );
};
