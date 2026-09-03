import React from 'react';
import { Composition } from 'remotion';
import { StorytimeComposition } from './StorytimeComposition';
import { TradingComposition } from './TradingComposition';

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="StorytimeVideo"
        component={StorytimeComposition}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          scenes: [],
          isShort: false
        }}
      />
      <Composition
        id="TradingVideo"
        component={TradingComposition}
        durationInFrames={300}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          title: 'SECRET BREAKOUT STRATEGY 🚀',
          strategyType: 'Bull Flag Breakout',
          scenes: [],
          isShort: true
        }}
      />
    </>
  );
};
