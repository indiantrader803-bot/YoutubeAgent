import React from 'react';
import { Composition } from 'remotion';
import { StorytimeComposition } from './StorytimeComposition';

export const RemotionRoot = () => {
  return (
    <Composition
      id="StorytimeVideo"
      component={StorytimeComposition}
      durationInFrames={300}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        scenes: [],
        audioPath: null,
        bgmPath: null,
        isShort: false
      }}
    />
  );
};
