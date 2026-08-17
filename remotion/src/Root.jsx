const React = require('react');
const { Composition } = require('remotion');
const { MainScene } = require('./Composition');

const RemotionRoot = () => {
  return React.createElement(Composition, {
    id: 'YoutubeAgentScene',
    component: MainScene,
    durationInFrames: 360,
    fps: 30,
    width: 1280,
    height: 720,
    defaultProps: {
      title: 'Default Video Title',
      subtitle: 'YoutubeAgent Open Source Engine',
      slides: []
    }
  });
};

module.exports = { RemotionRoot };
