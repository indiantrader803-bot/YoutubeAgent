import React from 'react';
import { useCurrentFrame, spring, useVideoConfig, Img, staticFile } from 'remotion';

export const CharacterSprite = ({
  pose = 'neutral_talk',
  speaker = 'hero',
  isSpeaking = true,
  position = 'center', // 'left', 'center', 'right'
  customImage = null
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Natural organic talk bounce & breath
  const talkBounce = isSpeaking ? Math.sin(frame * 0.45) * 12 : Math.sin(frame * 0.15) * 4;
  const breathScale = 1 + Math.sin(frame * 0.12) * 0.015;

  // Pop-in spring entrance on scene start
  const enterSpring = spring({
    frame: frame % 120,
    fps,
    config: { damping: 14, stiffness: 120 }
  });

  // Determine sprite file
  const spriteSrc = customImage || `file:///assets/characters/${speaker === 'teacher' ? 'teacher.png' : 'hero_' + pose + '.png'}`;

  const posX = position === 'left' ? '20%' : position === 'right' ? '80%' : '50%';

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '-40px',
        left: posX,
        transform: `translateX(-50%) translateY(${talkBounce}px) scale(${breathScale * Math.min(1, enterSpring + 0.2)})`,
        transformOrigin: 'bottom center',
        zIndex: 10,
        filter: 'drop-shadow(0 20px 30px rgba(0,0,0,0.45))'
      }}
    >
      <img
        src={spriteSrc}
        alt={pose}
        style={{
          width: '720px',
          height: 'auto',
          display: 'block',
          userSelect: 'none'
        }}
      />
    </div>
  );
};
