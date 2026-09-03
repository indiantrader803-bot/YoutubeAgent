import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  spring,
  useVideoConfig,
  Audio
} from 'remotion';
import { CharacterSprite } from './CharacterSprite';
import { SpeedLines } from './SpeedLines';
import { KineticSubtitles } from './KineticSubtitles';

export const StorytimeComposition = ({
  scenes = [],
  audioPath = null,
  bgmPath = null,
  isShort = false
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // Find active scene
  let currentScene = scenes[0] || {
    pose: 'neutral_talk',
    speaker: 'hero',
    background: 'classroom',
    text: '',
    zoom: 1.0,
    vfx: 'none'
  };

  let accumulatedFrames = 0;
  for (const scene of scenes) {
    if (frame >= accumulatedFrames && frame < accumulatedFrames + scene.durationInFrames) {
      currentScene = scene;
      break;
    }
    accumulatedFrames += scene.durationInFrames;
  }

  // Camera Zoom & Shake on Punchlines
  const targetZoom = currentScene.zoom || 1.0;
  const isAngryOrShocked = currentScene.pose === 'screaming_angry' || currentScene.pose === 'shocked';
  const shakeX = isAngryOrShocked ? Math.sin(frame * 0.8) * 8 : 0;
  const shakeY = isAngryOrShocked ? Math.cos(frame * 0.8) * 6 : 0;

  // Background Image Path
  const bgImage = currentScene.bgImage || `file:///assets/backgrounds/${currentScene.background || 'classroom'}.png`;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#020617',
        overflow: 'hidden'
      }}
    >
      {/* 1. Camera Transform Wrapper */}
      <div
        style={{
          width: '100%',
          height: '100%',
          transform: `scale(${targetZoom}) translate(${shakeX}px, ${shakeY}px)`,
          transformOrigin: 'center 70%',
          transition: 'transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        }}
      >
        {/* 2. 2D Cartoon Background */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundImage: `url("${bgImage}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            zIndex: 1
          }}
        />

        {/* 3. Anime Speed Lines Overlay on Screaming/Shocked Poses */}
        {(currentScene.vfx === 'speed_lines' || isAngryOrShocked) && (
          <SpeedLines width={width} height={height} opacity={0.8} />
        )}

        {/* 4. 2D Character Mascot Sprite */}
        <CharacterSprite
          pose={currentScene.pose || 'neutral_talk'}
          speaker={currentScene.speaker || 'hero'}
          isSpeaking={true}
          position={currentScene.speaker === 'teacher' ? 'right' : 'center'}
          customImage={currentScene.characterImage}
        />
      </div>

      {/* 5. Comic Punch Flash Effect on Scene Start */}
      {frame % 90 === 0 && (
        <AbsoluteFill
          style={{
            backgroundColor: '#ffffff',
            opacity: 0.25,
            pointerEvents: 'none',
            zIndex: 15
          }}
        />
      )}

      {/* 6. Kinetic Karaoke Subtitles (Overlay on Top) */}
      <KineticSubtitles text={currentScene.text} isShort={isShort} />
    </AbsoluteFill>
  );
};
