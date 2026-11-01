import React from 'react';
import { spring, interpolate } from 'remotion';

/**
 * Animated "Subscribe" prompt: slides in, a cursor moves over the red button,
 * clicks it (button turns grey -> SUBSCRIBED + check), and the bell rings.
 * `f` is the frame inside the CTA window (0 .. CTA_FRAMES).
 *
 * This is a plain on-screen call-to-action — it asks real viewers to
 * subscribe; it does not (and cannot) add subscribers by itself.
 */
export const CTA_FRAMES = 110;

export const SubscribeCTA = ({ f = 0, fps = 30, isShort = false, handle = '' }) => {
  const enter = spring({ frame: f, fps, config: { damping: 13, stiffness: 150 } });
  const exit = interpolate(f, [CTA_FRAMES - 12, CTA_FRAMES], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const clicked = f >= 60;
  const press = f >= 56 && f < 64 ? 0.93 : 1;
  const scale = (isShort ? 1.35 : 1) * Math.min(1, enter) * exit;

  // Cursor travels from lower-right toward the button, then clicks.
  const cx = interpolate(f, [24, 56], [210, 96], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const cy = interpolate(f, [24, 56], [120, 40], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const cursorOpacity = interpolate(f, [20, 28, 80, 92], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Bell wiggle after the click.
  const bellAngle = clicked ? Math.sin((f - 60) * 0.9) * 22 * Math.max(0, 1 - (f - 60) / 40) : 0;

  const pos = isShort
    ? { top: 210, left: '50%', transform: `translateX(-50%) scale(${scale})`, transformOrigin: 'top center' }
    : { top: 54, right: 56, transform: `scale(${scale})`, transformOrigin: 'top right' };

  return (
    <div style={{ position: 'absolute', zIndex: 60, ...pos, opacity: Math.min(1, enter) * exit }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '12px 18px',
          borderRadius: 22,
          background: 'rgba(15, 23, 42, 0.82)',
          boxShadow: '0 10px 28px rgba(0,0,0,0.5)',
          position: 'relative'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 24px',
            borderRadius: 999,
            background: clicked ? '#6b7280' : '#ff1f3d',
            color: '#fff',
            fontFamily: 'system-ui, "Segoe UI", "DejaVu Sans", Arial, sans-serif',
            fontWeight: 800,
            fontSize: 30,
            letterSpacing: 0.5,
            transform: `scale(${press})`
          }}
        >
          {clicked ? (
            <svg width="28" height="28" viewBox="0 0 28 28">
              <path d="M5 15 L12 22 L24 7" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
          {clicked ? 'SUBSCRIBED' : 'SUBSCRIBE'}
        </div>

        <svg width="46" height="46" viewBox="0 0 46 46" style={{ transform: `rotate(${bellAngle}deg)`, transformOrigin: '23px 6px' }}>
          <path
            d="M23 5 C14 5 10 12 10 20 L10 28 L6 34 L40 34 L36 28 L36 20 C36 12 32 5 23 5 Z"
            fill={clicked ? '#fde047' : '#e5e7eb'}
            stroke="#111827"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <circle cx="23" cy="39" r="4.5" fill={clicked ? '#fde047' : '#e5e7eb'} stroke="#111827" strokeWidth="2" />
        </svg>

        <svg
          width="44"
          height="44"
          viewBox="0 0 44 44"
          style={{ position: 'absolute', left: cx, top: cy, opacity: cursorOpacity, transform: `scale(${press === 1 ? 1 : 0.88})` }}
        >
          <path d="M6 4 L6 32 L13 26 L18 38 L23 36 L18 24 L28 24 Z" fill="#ffffff" stroke="#111827" strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
      </div>
      {handle ? (
        <div
          style={{
            marginTop: 8,
            textAlign: 'center',
            color: '#ffffff',
            fontFamily: 'system-ui, "Segoe UI", "DejaVu Sans", Arial, sans-serif',
            fontWeight: 700,
            fontSize: 22,
            textShadow: '0 2px 6px rgba(0,0,0,0.8)'
          }}
        >
          {handle}
        </div>
      ) : null}
    </div>
  );
};
