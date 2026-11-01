import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate
} from 'remotion';
import { CartoonCharacter } from './CartoonCharacter';
import { ParallaxBackground } from './ParallaxBackground';
import { WordCaptions } from './WordCaptions';
import { OrbitProp } from './OrbitProp';
import { SpeedLines } from './SpeedLines';
import { SubscribeCTA, CTA_FRAMES } from './SubscribeCTA';

const FONT = 'system-ui, "Segoe UI", "DejaVu Sans", Arial, sans-serif';

// Comic-style "!" / "?" badge that pops beside the character.
const Badge = ({ kind, isShort, delay = 8 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 8, stiffness: 190 } });
  if (frame < delay) return null;
  const wobble = Math.sin(frame * 0.35) * 6;
  const size = isShort ? 150 : 128;
  return (
    <div
      style={{
        position: 'absolute',
        top: isShort ? '19%' : '13%',
        right: isShort ? '10%' : '24%',
        width: size,
        height: size,
        borderRadius: '50%',
        background: kind === '?' ? '#38bdf8' : '#fde047',
        border: '8px solid #111827',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT,
        fontWeight: 900,
        fontSize: size * 0.7,
        color: '#111827',
        transform: `scale(${Math.max(0, s)}) rotate(${12 + wobble}deg)`,
        boxShadow: '0 12px 24px rgba(0,0,0,0.45)',
        zIndex: 25
      }}
    >
      {kind}
    </div>
  );
};

// Big hook title that pops in during the first scene.
const HookTitle = ({ title, isShort, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inS = spring({ frame: frame - 4, fps, config: { damping: 12, stiffness: 140 } });
  const out = interpolate(frame, [66, 80], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (frame > 80 || !title) return null;
  const text = title.length > 74 ? `${title.slice(0, 71)}...` : title;
  return (
    <div
      style={{
        position: 'absolute',
        top: isShort ? '9%' : '7%',
        left: '50%',
        transform: `translateX(-50%) scale(${Math.max(0, inS) * (0.9 + out * 0.1)})`,
        opacity: out,
        maxWidth: isShort ? '88%' : '70%',
        padding: isShort ? '22px 34px' : '18px 36px',
        borderRadius: 26,
        background: 'rgba(2,6,23,0.8)',
        border: `5px solid ${accent}`,
        boxShadow: '0 14px 34px rgba(0,0,0,0.55)',
        textAlign: 'center',
        fontFamily: FONT,
        fontWeight: 900,
        fontSize: isShort ? 66 : 56,
        lineHeight: 1.12,
        color: '#ffffff',
        textShadow: '0 4px 10px rgba(0,0,0,0.7)',
        zIndex: 40
      }}
    >
      {text}
    </div>
  );
};

// Diagonal accent-coloured wipe that sweeps away at the start of each scene.
const SceneWipe = ({ accent }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  if (frame > 12) return null;
  const x = interpolate(frame, [0, 12], [0, width * 1.5], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 50, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          top: '-10%',
          bottom: '-10%',
          left: -width * 0.25,
          width: width * 1.25,
          background: `linear-gradient(100deg, ${accent} 0%, #ffffff 82%)`,
          transform: `translateX(${x}px) skewX(-14deg)`
        }}
      />
    </div>
  );
};

const SceneView = ({ scene, index, isShort, title }) => {
  const frame = useCurrentFrame(); // local to this scene
  const { width, height } = useVideoConfig();
  const accent = scene.accent || '#38bdf8';
  const pose = scene.pose || 'neutral_talk';
  const dramatic = pose === 'screaming_angry' || pose === 'shocked';

  // Camera: slow push-in, punch + shake on dramatic scenes.
  const push = 1 + (frame / Math.max(1, scene.durationInFrames)) * 0.05;
  const punch = dramatic ? 1 + Math.max(0, 1 - frame / 12) * 0.14 + 0.05 : 1;
  const shakeX = dramatic ? Math.sin(frame * 1.7) * 7 : 0;
  const shakeY = dramatic ? Math.cos(frame * 1.9) * 5 : 0;

  const text = scene.text || '';
  const badge = /\?/.test(text) ? '?' : dramatic || pose === 'pointing' ? '!' : null;

  const charHeight = isShort ? Math.round(height * 0.5) : Math.round(height * 0.72);
  const flip = index % 2 === 1;
  const leftPct = isShort ? 50 : flip ? 66 : 34;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${push * punch}) translate(${shakeX}px, ${shakeY}px)`,
          transformOrigin: 'center 70%'
        }}
      >
        <ParallaxBackground
          bgImage={scene.bgImage}
          accent={accent}
          sceneIndex={index}
          durationInFrames={scene.durationInFrames}
        />
        {dramatic && <SpeedLines width={width} height={height} opacity={0.55} />}
        {!isShort && <OrbitProp accent={accent} side={flip ? 'left' : 'right'} />}
        <div
          style={{
            position: 'absolute',
            bottom: -24,
            left: `${leftPct}%`,
            transform: 'translateX(-50%)',
            zIndex: 10
          }}
        >
          <CartoonCharacter pose={pose} accent={accent} height={charHeight} flip={flip && !isShort} />
        </div>
        {badge && <Badge kind={badge} isShort={isShort} delay={index === 0 ? 84 : 8} />}
      </div>

      {index === 0 && <HookTitle title={title} isShort={isShort} accent={accent} />}
      <WordCaptions
        text={text}
        sceneDurationInFrames={scene.durationInFrames}
        isShort={isShort}
        accent={accent}
      />
      {index > 0 && <SceneWipe accent={accent} />}
    </AbsoluteFill>
  );
};

/**
 * Where subscribe prompts appear. One mid-video, one at the very end.
 * Very short clips only get the closing one.
 */
export const ctaWindows = (totalFrames) => {
  const windows = [];
  const endStart = Math.max(0, totalFrames - CTA_FRAMES - 10);
  if (totalFrames >= 420) windows.push(Math.round(totalFrames * 0.32));
  windows.push(endStart);
  return windows.filter((start, i, arr) => i === 0 || start - arr[i - 1] > CTA_FRAMES + 30);
};

export const CartoonStoryComposition = ({
  scenes = [],
  title = '',
  isShort = false,
  channelHandle = ''
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const total = durationInFrames;
  const activeCta = ctaWindows(total).find((start) => frame >= start && frame < start + CTA_FRAMES);
  const progress = Math.min(1, frame / Math.max(1, total));
  const accent = scenes[0]?.accent || '#38bdf8';

  return (
    <AbsoluteFill style={{ backgroundColor: '#020617' }}>
      {scenes.map((scene, i) => (
        <Sequence key={scene.id ?? i} from={scene.startFrame} durationInFrames={scene.durationInFrames}>
          <SceneView scene={scene} index={i} isShort={isShort} title={title} />
        </Sequence>
      ))}

      {/* retention progress bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, height: 7, width: `${progress * 100}%`, background: accent, zIndex: 70 }} />

      {activeCta !== undefined && (
        <SubscribeCTA f={frame - activeCta} fps={fps} isShort={isShort} handle={channelHandle} />
      )}
    </AbsoluteFill>
  );
};
