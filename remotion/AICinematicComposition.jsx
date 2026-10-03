import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate
} from 'remotion';
import { KineticSubtitles } from './KineticSubtitles';

// ─────────────────────────────────────────────────────────────────────────────
// AI Cinematic Composition — procedural motion-graphics renderer.
//
// Every scene is drawn from code (gradients, starfields, perspective grids,
// orbiting planets, skylines, particle fields) so each video gets a completely
// different cinematic look with ZERO stock assets, ZERO image-API cost and
// deterministic output in CI. Camera drift + multi-layer parallax + optional
// 3D perspective tilt give it the depth of a "3D render" style.
// ─────────────────────────────────────────────────────────────────────────────

const seeded = (n) => {
  const x = Math.sin(n) * 43758.5453123;
  return x - Math.floor(x);
};
const rnd = (seed, n) => seeded(seed * 7.13 + n * 3.717);

const Starfield = ({ scene, width, height, frame, count = 70 }) => (
  <AbsoluteFill>
    {Array.from({ length: count }).map((_, i) => {
      const x = rnd(scene.seed, i) * width;
      const y = rnd(scene.seed, i + 100) * height * 0.85;
      const r = 1 + rnd(scene.seed, i + 200) * 2.4;
      const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(frame * 0.045 + i * 1.7));
      const drift = (frame * (0.12 + rnd(scene.seed, i + 300) * 0.25)) % (width + 80);
      return (
        <div
          key={`st-${i}`}
          style={{
            position: 'absolute',
            left: ((x + drift) % (width + 80)) - 40,
            top: y,
            width: r * 2,
            height: r * 2,
            borderRadius: '50%',
            background: '#ffffff',
            opacity: twinkle,
            boxShadow: '0 0 6px 1px rgba(255,255,255,0.55)'
          }}
        />
      );
    })}
  </AbsoluteFill>
);

const Orbit = ({ scene, width, height, frame, palette }) => {
  const cx = width * (0.3 + rnd(scene.seed, 5) * 0.4);
  const cy = height * (0.34 + rnd(scene.seed, 6) * 0.18);
  const pr = Math.min(width, height) * (0.16 + rnd(scene.seed, 7) * 0.08);
  return (
    <AbsoluteFill>
      {/* Planet body */}
      <div
        style={{
          position: 'absolute',
          left: cx - pr,
          top: cy - pr,
          width: pr * 2,
          height: pr * 2,
          borderRadius: '50%',
          background: `radial-gradient(circle at 34% 30%, ${palette.glow} 0%, ${palette.mid} 46%, ${palette.deep} 78%)`,
          boxShadow: `0 0 ${pr * 0.7}px ${palette.glow}55, inset ${-pr * 0.18}px ${-pr * 0.1}px ${pr * 0.4}px rgba(0,0,0,0.65)`
        }}
      />
      {/* Ring */}
      <div
        style={{
          position: 'absolute',
          left: cx - pr * 1.9,
          top: cy - pr * 0.5,
          width: pr * 3.8,
          height: pr,
          borderRadius: '50%',
          border: `${Math.max(3, pr * 0.045)}px solid ${palette.accent}66`,
          transform: `rotate(-16deg)`,
          opacity: 0.85
        }}
      />
      {/* Moons */}
      {[0, 1, 2].map((m) => {
        const angle = frame * 0.017 + m * 2.1 + rnd(scene.seed, m + 40) * 6.28;
        const orbitR = pr * (1.7 + m * 0.55);
        const mx = cx + Math.cos(angle) * orbitR;
        const my = cy + Math.sin(angle) * orbitR * 0.42;
        const mr = pr * (0.05 + rnd(scene.seed, m + 60) * 0.045);
        return (
          <div
            key={`moon-${m}`}
            style={{
              position: 'absolute',
              left: mx - mr,
              top: my - mr,
              width: mr * 2,
              height: mr * 2,
              borderRadius: '50%',
              background: palette.accent,
              opacity: 0.9,
              boxShadow: `0 0 14px ${palette.accent}aa`
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const PerspectiveGrid = ({ scene, width, height, frame, palette }) => {
  const horizon = height * 0.52;
  const lines = [];
  for (let i = 0; i < 16; i++) {
    const t = (i + ((frame * 0.012) % 1)) / 16;
    const y = horizon + Math.pow(t, 2.2) * (height - horizon);
    lines.push(y);
  }
  const verticals = Array.from({ length: 17 }).map((_, i) => {
    const spread = (i - 8) / 8;
    return { xBottom: width / 2 + spread * width * 1.35, xTop: width / 2 + spread * width * 0.05 };
  });
  return (
    <AbsoluteFill>
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id={`g-${scene.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.deep} />
            <stop offset="100%" stopColor={palette.mid} stopOpacity="0.35" />
          </linearGradient>
        </defs>
        {/* Horizon glow */}
        <rect x="0" y={horizon - 3} width={width} height="6" fill={palette.accent} opacity="0.85" />
        <rect x="0" y={horizon - 22} width={width} height="44" fill={palette.accent} opacity="0.12" />
        {lines.map((y, i) => (
          <line key={`h-${i}`} x1="0" y1={y} x2={width} y2={y} stroke={palette.accent} strokeWidth={1 + (i / 16) * 2} opacity={0.16 + (i / 16) * 0.4} />
        ))}
        {verticals.map((v, i) => (
          <line key={`v-${i}`} x1={v.xTop} y1={horizon} x2={v.xBottom} y2={height} stroke={palette.accent} strokeWidth="1.5" opacity="0.28" />
        ))}
      </svg>
      {/* Floating glass panes (3D depth cue) */}
      {[0, 1, 2, 3].map((p) => {
        const px = rnd(scene.seed, p + 70) * width * 0.85;
        const py = height * (0.12 + rnd(scene.seed, p + 80) * 0.3);
        const bob = Math.sin(frame * 0.03 + p * 1.9) * 16;
        const s = 70 + rnd(scene.seed, p + 90) * 90;
        return (
          <div
            key={`pane-${p}`}
            style={{
              position: 'absolute',
              left: px,
              top: py + bob,
              width: s,
              height: s,
              borderRadius: 18,
              border: `2px solid ${palette.accent}55`,
              background: `linear-gradient(135deg, ${palette.glow}22, ${palette.accent}11)`,
              backdropFilter: 'blur(2px)',
              transform: `rotate(${rnd(scene.seed, p + 95) * 40 - 20}deg)`,
              opacity: 0.75
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const Waves = ({ scene, width, height, frame, palette }) => (
  <AbsoluteFill>
    {[0, 1, 2, 3].map((layer) => {
      const amp = height * (0.05 + layer * 0.022);
      const baseY = height * (0.42 + layer * 0.14);
      const phase = frame * (0.035 + layer * 0.012) + layer * 1.3;
      const points = [];
      for (let x = 0; x <= width; x += 32) {
        const y = baseY + Math.sin(x / 210 + phase + rnd(scene.seed, layer + x) * 0.4) * amp;
        points.push(`${x},${y.toFixed(1)}`);
      }
      return (
        <svg key={`w-${layer}`} width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
          <polygon
            points={`0,${height} ${points.join(' ')} ${width},${height}`}
            fill={layer % 2 === 0 ? palette.mid : palette.glow}
            opacity={0.16 + layer * 0.13}
          />
          <polyline points={points.join(' ')} fill="none" stroke={palette.accent} strokeWidth="2" opacity={0.25 + layer * 0.1} />
        </svg>
      );
    })}
  </AbsoluteFill>
);

const City = ({ scene, width, height, frame, palette }) => {
  const building = (seedBase, yBase, maxH, opacity, drift) => {
    const rects = [];
    let x = -60 + (frame * drift) % 120;
    let i = 0;
    while (x < width + 60) {
      const bw = 46 + rnd(scene.seed, seedBase + i) * 110;
      const bh = maxH * (0.35 + rnd(scene.seed, seedBase + i + 500) * 0.65);
      rects.push({ x, y: yBase - bh, w: bw, h: bh, i });
      x += bw + 14 + rnd(scene.seed, seedBase + i + 900) * 30;
      i++;
    }
    return rects;
  };
  return (
    <AbsoluteFill>
      {/* Moon */}
      <div
        style={{
          position: 'absolute',
          left: width * 0.72,
          top: height * 0.12,
          width: height * 0.1,
          height: height * 0.1,
          borderRadius: '50%',
          background: `radial-gradient(circle at 40% 36%, #ffffff, ${palette.glow})`,
          boxShadow: `0 0 ${height * 0.05}px ${palette.glow}99`
        }}
      />
      {[0, 1].map((layer) => (
        <svg key={`sky-${layer}`} width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
          {building(layer * 31 + 13, height, height * (layer === 0 ? 0.5 : 0.34), layer, layer === 0 ? 0.25 : 0.5).map((b) => (
            <rect
              key={b.i}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              fill={layer === 0 ? palette.mid : palette.deep}
              opacity={layer === 0 ? 0.85 : 1}
            />
          ))}
        </svg>
      ))}
      {/* Haze */}
      <AbsoluteFill style={{ background: `linear-gradient(to top, ${palette.deep}cc 0%, transparent 45%)` }} />
    </AbsoluteFill>
  );
};

const Particles = ({ scene, width, height, frame, palette }) => (
  <AbsoluteFill>
    {Array.from({ length: 26 }).map((_, i) => {
      const s = 14 + rnd(scene.seed, i + 11) * 70;
      const speed = 0.25 + rnd(scene.seed, i + 22) * 0.7;
      const x = (rnd(scene.seed, i) * width + frame * speed) % (width + 160) - 80;
      const y = (rnd(scene.seed, i + 44) * height + Math.sin(frame * 0.02 + i) * 26) % (height + 160) - 80;
      return (
        <div
          key={`orb-${i}`}
          style={{
            position: 'absolute',
            left: x,
            top: y,
            width: s,
            height: s,
            borderRadius: '50%',
            background: `radial-gradient(circle at 36% 32%, ${palette.glow}, ${palette.accent}44 62%, transparent 74%)`,
            filter: 'blur(1px)',
            opacity: 0.5 + rnd(scene.seed, i + 55) * 0.4
          }}
        />
      );
    })}
    {/* Light streaks */}
    {[0, 1, 2].map((k) => {
      const off = ((frame * (1.1 + k * 0.4)) % (width + 600)) - 300;
      return (
        <div
          key={`streak-${k}`}
          style={{
            position: 'absolute',
            left: off,
            top: height * (0.18 + k * 0.24),
            width: 340,
            height: 3,
            borderRadius: 3,
            background: `linear-gradient(90deg, transparent, ${palette.accent}, transparent)`,
            opacity: 0.35,
            transform: 'rotate(-14deg)'
          }}
        />
      );
    })}
  </AbsoluteFill>
);

const KIND_RENDERERS = {
  stars: Starfield,
  orbit: (p) => (
    <>
      <Starfield {...p} count={50} />
      <Orbit {...p} />
    </>
  ),
  grid: PerspectiveGrid,
  waves: (p) => (
    <>
      <Starfield {...p} count={24} />
      <Waves {...p} />
    </>
  ),
  city: City,
  particles: (p) => (
    <>
      <Starfield {...p} count={30} />
      <Particles {...p} />
    </>
  )
};

export const AICinematicComposition = ({ scenes = [], isShort = false }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  let currentScene = scenes[0] || {
    id: 0,
    startFrame: 0,
    durationInFrames: 90,
    kind: 'particles',
    palette: { deep: '#020617', mid: '#1e1b4b', glow: '#38bdf8', accent: '#818cf8' },
    title: '',
    text: '',
    depth: 0.6,
    seed: 1
  };
  for (const scene of scenes) {
    if (frame >= scene.startFrame && frame < scene.startFrame + scene.durationInFrames) {
      currentScene = scene;
      break;
    }
  }

  const sceneFrame = frame - currentScene.startFrame;
  const sceneLen = Math.max(1, currentScene.durationInFrames);
  const progress = sceneFrame / sceneLen;
  const palette = currentScene.palette || { deep: '#020617', mid: '#1e1b4b', glow: '#38bdf8', accent: '#818cf8' };
  const depth = currentScene.depth ?? 0.6;

  // Camera: slow push-in + gentle drift.
  const zoom = 1.0 + progress * (0.06 + depth * 0.05);
  const panX = Math.sin(progress * Math.PI) * (10 + depth * 22);
  const panY = Math.cos(progress * Math.PI * 0.8) * (6 + depth * 10);

  const KindLayer = KIND_RENDERERS[currentScene.kind] || KIND_RENDERERS.particles;

  const titleIn = spring({
    frame: sceneFrame,
    fps,
    config: { damping: 15, stiffness: 130 }
  });

  return (
    <AbsoluteFill style={{ backgroundColor: palette.deep, overflow: 'hidden' }}>
      {/* Deep gradient base */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 90% at 22% 12%, ${palette.mid} 0%, ${palette.deep} 58%, #000000 130%)`
        }}
      />

      {/* Parallax scene layers inside camera transform */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${zoom}) translate(${panX}px, ${panY}px) perspective(1400px) rotateX(${depth * 2.4}deg)`,
          transformOrigin: 'center 60%'
        }}
      >
        <KindLayer scene={currentScene} width={width} height={height} frame={frame} palette={palette} />
      </div>

      {/* Section title — bold kinetic headline */}
      {currentScene.title ? (
        <div
          style={{
            position: 'absolute',
            top: isShort ? 200 : 120,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            zIndex: 15,
            opacity: interpolate(sceneFrame, [sceneLen - 25, sceneLen - 6], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
          }}
        >
          <div
            style={{
              transform: `scale(${0.9 + Math.min(1, titleIn) * 0.1}) translateY(${(1 - Math.min(1, titleIn)) * 26}px)`,
              textAlign: 'center',
              maxWidth: '82%'
            }}
          >
            <div
              style={{
                display: 'inline-block',
                fontSize: isShort ? 58 : 54,
                fontWeight: 900,
                letterSpacing: '0.5px',
                color: '#ffffff',
                textShadow: `0 4px 24px ${palette.accent}88, 0 2px 6px rgba(0,0,0,0.8)`,
                lineHeight: 1.15
              }}
            >
              {String(currentScene.title).toUpperCase().slice(0, 60)}
            </div>
            <div
              style={{
                marginTop: 12,
                width: 120,
                height: 5,
                borderRadius: 3,
                margin: '12px auto 0',
                background: `linear-gradient(90deg, ${palette.glow}, ${palette.accent})`
              }}
            />
          </div>
        </div>
      ) : null}

      {/* Cinematic vignette + grain */}
      <AbsoluteFill
        style={{
          background: 'radial-gradient(130% 110% at 50% 42%, transparent 55%, rgba(0,0,0,0.55) 100%)',
          zIndex: 16,
          pointerEvents: 'none'
        }}
      />
      <AbsoluteFill
        style={{
          zIndex: 17,
          opacity: 0.05,
          pointerEvents: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'repeat'
        }}
      />

      {/* One-line bottom captions */}
      <KineticSubtitles
        text={currentScene.text}
        frameInScene={sceneFrame}
        sceneDurationInFrames={sceneLen}
        isShort={isShort}
        accent={palette.accent}
      />
    </AbsoluteFill>
  );
};
