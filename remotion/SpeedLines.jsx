import React from 'react';
import { useCurrentFrame } from 'remotion';

export const SpeedLines = ({ width = 1920, height = 1080, opacity = 0.75 }) => {
  const frame = useCurrentFrame();
  const seed = (frame % 3) * 15;
  const numLines = 36;
  const lines = [];

  const cx = width / 2;
  const cy = height / 2;

  for (let i = 0; i < numLines; i++) {
    const angle = (i / numLines) * 2 * Math.PI + (seed * Math.PI) / 180;
    const rInner = 280 + ((i % 5) * 40);
    const rOuter = Math.max(width, height);

    const x1 = cx + rInner * Math.cos(angle);
    const y1 = cy + rInner * Math.sin(angle);
    const x2 = cx + rOuter * Math.cos(angle);
    const y2 = cy + rOuter * Math.sin(angle);

    lines.push(
      <polygon
        key={i}
        points={`${cx},${cy} ${x2 + 25 * Math.sin(angle)},${y2 - 25 * Math.cos(angle)} ${x2 - 25 * Math.sin(angle)},${y2 + 25 * Math.cos(angle)}`}
        fill="#ffffff"
        opacity={((i + frame) % 2 === 0 ? 0.8 : 0.4) * opacity}
      />
    );
  }

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 5
      }}
      viewBox={`0 0 ${width} ${height}`}
    >
      <defs>
        <radialGradient id="centerFade" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000000" stopOpacity="0" />
          <stop offset="40%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="1" />
        </radialGradient>
        <mask id="speedMask">
          <rect width={width} height={height} fill="url(#centerFade)" />
        </mask>
      </defs>
      <g mask="url(#speedMask)">{lines}</g>
    </svg>
  );
};
