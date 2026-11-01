import React from 'react';
import { useCurrentFrame, useVideoConfig, spring } from 'remotion';

/**
 * Fully vector, fully animated 2D mascot (no PNG sprites).
 *
 * Per-frame animation:
 *  - eye blinks on a natural cycle, pupils drift around
 *  - pseudo lip-sync: mouth opens/closes in speech-like bursts with pauses
 *  - emotion-specific face (neutral / pointing / shocked / angry / laughing / sad)
 *  - arm gestures, head tilt + bob, breathing, pop-in entrance
 */

const EMOTION_BY_POSE = {
  neutral_talk: 'neutral',
  pointing: 'pointing',
  shocked: 'shocked',
  screaming_angry: 'angry',
  laughing: 'laughing',
  crying: 'sad'
};

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

export const shade = (hex, amount) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = clamp255(((n >> 16) & 255) * (1 + amount));
  const g = clamp255(((n >> 8) & 255) * (1 + amount));
  const b = clamp255((n & 255) * (1 + amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
};

const BROWS = {
  neutral: ['M138 222 Q160 212 184 220', 'M216 220 Q240 212 262 222'],
  pointing: ['M138 218 Q160 206 184 216', 'M216 216 Q240 206 262 218'],
  angry: ['M134 210 L188 234', 'M212 234 L266 210'],
  shocked: ['M138 198 Q160 182 184 196', 'M216 196 Q240 182 262 198'],
  sad: ['M138 232 Q160 226 184 210', 'M216 210 Q240 226 262 232'],
  laughing: ['M138 214 Q160 202 184 212', 'M216 212 Q240 202 262 214']
};

export const CartoonCharacter = ({
  pose = 'neutral_talk',
  accent = '#38bdf8',
  height = 760,
  flip = false,
  isSpeaking = true
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const emotion = EMOTION_BY_POSE[pose] || 'neutral';

  const enter = spring({ frame, fps, config: { damping: 11, stiffness: 150 } });
  const bob = Math.sin(frame * 0.1) * 5;
  const tilt = Math.sin(frame * 0.07) * 2.6 + (emotion === 'angry' ? Math.sin(frame * 1.3) * 1.4 : 0);

  // Blink: closes for ~6 frames every 96 frames.
  const cycle = (frame + 20) % 96;
  const blink = cycle >= 90 ? 1 - Math.abs(cycle - 93) / 3 : 0;
  const eyeScale = 1 - 0.92 * Math.max(0, blink);

  // Speech bursts with pauses so the mouth never just buzzes forever.
  const gate = (Math.sin(frame * 0.11 + 0.7) + 1) / 2 > 0.14;
  const talk = isSpeaking && gate
    ? 0.12 + 0.88 * Math.abs(Math.sin(frame * 0.62)) * (0.6 + 0.4 * Math.abs(Math.sin(frame * 0.27)))
    : 0.04;

  const lookX = Math.sin(frame * 0.045) * 4.5;
  const lookY = Math.cos(frame * 0.037) * 2.5;

  const hoodie = shade(accent, -0.28);
  const hoodieDark = shade(accent, -0.5);
  const skin = '#f6c9a0';
  const skinDark = '#e2a77d';

  // Right-arm gesture angle (negative = swings outward/up for the right arm).
  let armR = -22 + Math.sin(frame * 0.12) * 14;
  let armL = 10 + Math.sin(frame * 0.09 + 1) * 5;
  if (emotion === 'pointing') {
    armR = -128 + Math.sin(frame * 0.25) * 6;
  } else if (emotion === 'angry') {
    armR = -150 + Math.sin(frame * 1.1) * 9;
    armL = 150 - Math.sin(frame * 1.1 + 1) * 9;
  } else if (emotion === 'shocked') {
    armR = -155 + Math.sin(frame * 0.5) * 3;
    armL = 155 - Math.sin(frame * 0.5) * 3;
  } else if (emotion === 'laughing') {
    armR = -60 + Math.sin(frame * 0.7) * 12;
    armL = 40 - Math.sin(frame * 0.7) * 10;
  } else if (emotion === 'sad') {
    armR = -8;
    armL = 8;
  }

  const width = (height * 400) / 540;
  const brows = BROWS[emotion] || BROWS.neutral;
  const mouthRx = 22 + talk * 6;
  const mouthRy = 4 + talk * 21;

  const renderEyes = () => {
    if (emotion === 'laughing') {
      return (
        <g stroke="#2b1a12" strokeWidth="9" strokeLinecap="round" fill="none">
          <path d="M138 262 Q160 236 184 262" />
          <path d="M216 262 Q240 236 262 262" />
        </g>
      );
    }
    const big = emotion === 'shocked';
    const rx = big ? 29 : 24;
    const ry = big ? 36 : 28;
    const pr = big ? 8 : 12;
    return (
      <g>
        {[160, 240].map((cx) => (
          <g key={cx} transform={`translate(${cx} 256) scale(1 ${eyeScale})`}>
            <ellipse rx={rx} ry={ry} fill="#ffffff" stroke="#2b1a12" strokeWidth="4" />
            <circle cx={lookX} cy={lookY} r={pr} fill="#1b1008" />
            <circle cx={lookX + 4} cy={lookY - 4} r="3.6" fill="#ffffff" />
          </g>
        ))}
        {emotion === 'sad' && (
          <>
            {[160, 240].map((cx, i) => {
              const t = (frame * 2 + i * 25) % 70;
              return (
                <ellipse
                  key={cx}
                  cx={cx + (i ? 6 : -6)}
                  cy={286 + t * 1.4}
                  rx="7"
                  ry="11"
                  fill="#7dd3fc"
                  opacity={1 - t / 80}
                />
              );
            })}
          </>
        )}
      </g>
    );
  };

  const renderMouth = () => {
    if (emotion === 'shocked') {
      const w = 18 + Math.sin(frame * 0.4) * 2;
      const h = 27 + Math.sin(frame * 0.4) * 3;
      return <ellipse cx="200" cy="332" rx={w} ry={h} fill="#4a1414" stroke="#2b1a12" strokeWidth="4" />;
    }
    if (emotion === 'laughing') {
      const open = 46 + talk * 24 + Math.abs(Math.sin(frame * 0.9)) * 8;
      return (
        <g>
          <clipPath id="laughMouth">
            <path d={`M160 310 Q200 ${310 + open} 240 310 Z`} />
          </clipPath>
          <path d={`M160 310 Q200 ${310 + open} 240 310 Z`} fill="#4a1414" stroke="#2b1a12" strokeWidth="4" strokeLinejoin="round" />
          <g clipPath="url(#laughMouth)">
            <rect x="160" y="308" width="80" height="14" fill="#ffffff" />
            <ellipse cx="200" cy={310 + open * 0.72} rx="26" ry="16" fill="#ff7a8a" />
          </g>
        </g>
      );
    }
    if (emotion === 'sad') {
      return (
        <path
          d={`M172 338 Q200 ${314 - talk * 6} 228 338`}
          fill="none"
          stroke="#2b1a12"
          strokeWidth="8"
          strokeLinecap="round"
        />
      );
    }
    const wide = emotion === 'angry' ? 1.18 : 1;
    return (
      <g>
        <clipPath id="talkMouth">
          <ellipse cx="200" cy="328" rx={mouthRx * wide} ry={mouthRy} />
        </clipPath>
        <ellipse cx="200" cy="328" rx={mouthRx * wide} ry={mouthRy} fill="#4a1414" stroke="#2b1a12" strokeWidth="4" />
        <g clipPath="url(#talkMouth)">
          <rect x="170" y={328 - mouthRy} width="60" height="9" fill="#ffffff" />
          <ellipse cx="200" cy={328 + mouthRy * 0.62} rx={mouthRx * 0.62} ry={mouthRy * 0.46} fill="#ff7a8a" />
        </g>
      </g>
    );
  };

  const renderArm = (cx, angle, key) => (
    <g key={key} transform={`rotate(${angle} ${cx} 428)`}>
      <rect x={cx - 22} y="428" width="44" height="150" rx="22" fill={hoodie} stroke={hoodieDark} strokeWidth="4" />
      <circle cx={cx} cy="588" r="27" fill={skin} stroke={skinDark} strokeWidth="4" />
      {emotion === 'pointing' && key === 'r' && (
        <rect x={cx - 7} y="600" width="14" height="38" rx="7" fill={skin} stroke={skinDark} strokeWidth="3" />
      )}
    </g>
  );

  return (
    <div
      style={{
        width,
        height,
        transform: `translateY(${(1 - Math.min(1, enter)) * 160 + bob}px) scale(${flip ? -1 : 1}, 1) scale(${0.9 + 0.1 * Math.min(1.05, enter)})`,
        transformOrigin: 'bottom center',
        willChange: 'transform'
      }}
    >
      <svg viewBox="0 0 400 540" width={width} height={height} style={{ overflow: 'visible' }}>
        {/* arms behind the torso edge */}
        {renderArm(92, armL, 'l')}
        {renderArm(308, armR, 'r')}

        {/* torso / hoodie */}
        <path d="M62 560 Q62 402 138 374 L200 396 L262 374 Q338 402 338 560 Z" fill={hoodie} stroke={hoodieDark} strokeWidth="5" />
        <ellipse cx="200" cy="388" rx="104" ry="36" fill={hoodieDark} />
        <path d="M176 410 L172 470 M224 410 L228 470" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" opacity="0.85" />
        <path d="M150 470 Q200 500 250 470" fill="none" stroke={hoodieDark} strokeWidth="4" opacity="0.6" />

        {/* neck */}
        <rect x="172" y="352" width="56" height="48" rx="14" fill={skinDark} />

        {/* head group */}
        <g transform={`rotate(${tilt} 200 350) translate(0 ${emotion === 'laughing' ? Math.sin(frame * 0.9) * 5 : Math.sin(frame * 0.3) * (talk * 3)})`}>
          <circle cx="84" cy="266" r="21" fill={skin} stroke={skinDark} strokeWidth="4" />
          <circle cx="316" cy="266" r="21" fill={skin} stroke={skinDark} strokeWidth="4" />
          <circle cx="200" cy="255" r="118" fill={skin} stroke={skinDark} strokeWidth="5" />
          {emotion === 'angry' && <circle cx="200" cy="255" r="118" fill="#ef4444" opacity={0.2 + Math.abs(Math.sin(frame * 0.5)) * 0.08} />}
          {/* hair */}
          <path
            d="M82 248 Q86 118 200 110 Q314 118 318 248 Q304 178 252 160 Q200 190 148 160 Q96 178 82 248 Z"
            fill="#2b2118"
            stroke="#150e08"
            strokeWidth="4"
            strokeLinejoin="round"
          />
          <path d="M150 128 Q178 112 214 120" fill="none" stroke="#4a3a2a" strokeWidth="6" strokeLinecap="round" opacity="0.7" />
          {/* cheeks + nose */}
          <ellipse cx="128" cy="304" rx="22" ry="13" fill="#ff8f9a" opacity={emotion === 'laughing' ? 0.7 : 0.4} />
          <ellipse cx="272" cy="304" rx="22" ry="13" fill="#ff8f9a" opacity={emotion === 'laughing' ? 0.7 : 0.4} />
          <path d="M194 286 Q200 296 208 288" fill="none" stroke={skinDark} strokeWidth="5" strokeLinecap="round" />
          {renderEyes()}
          <g fill="none" stroke="#2b1a12" strokeWidth="9" strokeLinecap="round">
            <path d={brows[0]} />
            <path d={brows[1]} />
          </g>
          {renderMouth()}
          {emotion === 'shocked' && (
            <g fill="#bae6fd" opacity="0.9">
              <path d="M330 196 q10 18 0 28 q-10 -10 0 -28 z" />
              <path d="M70 176 q10 18 0 28 q-10 -10 0 -28 z" />
            </g>
          )}
        </g>
      </svg>
    </div>
  );
};
