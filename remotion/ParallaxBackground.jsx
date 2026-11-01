import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { shade } from './CartoonCharacter';

// Deterministic pseudo-random so every render frame agrees with itself.
const rnd = (i, k) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * Layered animated backdrop: slow Ken-Burns on the themed image, drifting
 * shapes (circles / rings / plus signs), swaying foreground hills, light
 * glow and a vignette. Nothing here is a flat still.
 */
export const ParallaxBackground = ({ bgImage, accent = '#38bdf8', sceneIndex = 0, durationInFrames = 150 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const p = frame / Math.max(1, durationInFrames);
  const dir = sceneIndex % 2 ? -1 : 1;
  const scale = 1.08 + p * 0.08;
  const tx = dir * (p - 0.5) * 70;

  const shapes = Array.from({ length: 18 }, (_, i) => {
    const speed = 0.35 + rnd(i, 2) * 1.0;
    const size = 8 + rnd(i, 4) * 30;
    const span = height + 160;
    const y = height + 80 - ((frame * speed * 1.6 + rnd(i, 3) * span) % span);
    const x = rnd(i, 1) * width + Math.sin((frame + i * 23) * 0.025) * 28;
    const op = 0.1 + rnd(i, 5) * 0.22;
    const kind = i % 3;
    return { i, x, y, size, op, kind, rot: frame * (0.4 + rnd(i, 6)) * (i % 2 ? 1 : -1) };
  });

  const hill = (baseY, amp, phase, color, opacity) => {
    let d = `M0 ${height} L0 ${baseY}`;
    for (let x = 0; x <= width + 60; x += 60) {
      d += ` L${x} ${(baseY + Math.sin(x / 260 + phase) * amp).toFixed(1)}`;
    }
    d += ` L${width} ${height} Z`;
    return <path d={d} fill={color} opacity={opacity} />;
  };

  const sway = Math.sin(frame * 0.02) * 14;

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: shade(accent, -0.85) }}>
      {bgImage && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url("${bgImage}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            transform: `scale(${scale}) translateX(${tx}px)`
          }}
        />
      )}

      {/* soft accent glow that slowly breathes */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(circle at ${50 + dir * 18}% 38%, ${accent}55 0%, transparent ${52 + Math.sin(frame * 0.04) * 6}%)`
        }}
      />

      <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
        {shapes.map((s) => {
          if (s.kind === 0) return <circle key={s.i} cx={s.x} cy={s.y} r={s.size / 2} fill={accent} opacity={s.op} />;
          if (s.kind === 1) {
            return <circle key={s.i} cx={s.x} cy={s.y} r={s.size / 2} fill="none" stroke="#ffffff" strokeWidth="3" opacity={s.op + 0.05} />;
          }
          const h = s.size / 2;
          return (
            <g key={s.i} transform={`translate(${s.x} ${s.y}) rotate(${s.rot})`} opacity={s.op + 0.05} stroke="#ffffff" strokeWidth="4" strokeLinecap="round">
              <line x1={-h} y1="0" x2={h} y2="0" />
              <line x1="0" y1={-h} x2="0" y2={h} />
            </g>
          );
        })}
        <g transform={`translate(${sway} 0)`}>{hill(height * 0.86, 22, 0.4, shade(accent, -0.7), 0.55)}</g>
        <g transform={`translate(${-sway * 1.6} 0)`}>{hill(height * 0.93, 16, 2.1, shade(accent, -0.82), 0.8)}</g>
      </svg>

      {/* vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.5) 100%)'
        }}
      />
    </div>
  );
};
