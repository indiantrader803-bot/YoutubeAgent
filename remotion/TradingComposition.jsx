import React from 'react';
import { AbsoluteFill, useCurrentFrame, spring, useVideoConfig } from 'remotion';
import { TradingChart } from './TradingChart';
import { KineticSubtitles } from './KineticSubtitles';

export const TradingComposition = ({
  title = 'SECRET BREAKOUT STRATEGY 🚀',
  strategyType = 'Bull Flag Breakout',
  scenes = [],
  isShort = true
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  let currentScene = scenes[0] || {
    text: 'Look for this powerful candlestick pattern before entering a trade!'
  };

  let accumulated = 0;
  for (const scene of scenes) {
    if (frame >= accumulated && frame < accumulated + scene.durationInFrames) {
      currentScene = scene;
      break;
    }
    accumulated += scene.durationInFrames;
  }

  const badgeSpring = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 140 }
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#020617',
        backgroundImage: 'radial-gradient(circle at 50% 10%, #1e1b4b 0%, #020617 80%)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isShort ? '40px 20px' : '30px'
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: isShort ? '100px' : '40px',
          transform: 'scale(' + badgeSpring + ')',
          padding: '16px 40px',
          background: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
          borderRadius: '30px',
          border: '3px solid #38bdf8',
          boxShadow: '0 10px 30px rgba(2, 132, 199, 0.5)',
          zIndex: 10,
          textAlign: 'center'
        }}
      >
        <span
          style={{
            fontFamily: 'Impact, "Arial Black", sans-serif',
            fontSize: isShort ? '42px' : '36px',
            fontWeight: '900',
            color: '#ffffff',
            letterSpacing: '2px',
            textTransform: 'uppercase'
          }}
        >
          {strategyType.toUpperCase()}
        </span>
      </div>

      <div
        style={{
          marginTop: isShort ? '80px' : '40px',
          zIndex: 5
        }}
      >
        <TradingChart patternType="bull_flag" isShort={isShort} />
      </div>

      <div
        style={{
          display: 'flex',
          gap: '20px',
          marginTop: '30px',
          zIndex: 8
        }}
      >
        <div style={{ padding: '10px 24px', background: 'rgba(34, 197, 94, 0.2)', border: '2px solid #22c55e', borderRadius: '16px' }}>
          <span style={{ color: '#4ade80', fontSize: '24px', fontWeight: '900', fontFamily: 'sans-serif' }}>WIN RATE: 82%</span>
        </div>
        <div style={{ padding: '10px 24px', background: 'rgba(56, 189, 248, 0.2)', border: '2px solid #38bdf8', borderRadius: '16px' }}>
          <span style={{ color: '#38bdf8', fontSize: '24px', fontWeight: '900', fontFamily: 'sans-serif' }}>RISK REWARD: 1:3</span>
        </div>
      </div>

      <KineticSubtitles text={currentScene.text} isShort={isShort} />
    </AbsoluteFill>
  );
};
