const React = require('react');
const { AbsoluteFill, interpolate, useCurrentFrame } = require('remotion');

const MainScene = ({ title, subtitle, slides = [] }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1], { extrapolateLeft: 'clamp' });
  const scale = interpolate(frame, [0, 300], [1, 1.05], { extrapolateLeft: 'clamp' });

  return React.createElement(
    AbsoluteFill,
    {
      style: {
        backgroundColor: '#0f172a',
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: 'Arial, sans-serif',
        color: '#ffffff',
        transform: `scale(${scale})`,
        opacity
      }
    },
    React.createElement('h1', { style: { fontSize: 52, fontWeight: 'bold', textAlign: 'center' } }, title),
    React.createElement('p', { style: { fontSize: 26, color: '#38bdf8', marginTop: 20 } }, subtitle)
  );
};

module.exports = { MainScene };
