import React from 'react';
import { useCurrentFrame, spring, useVideoConfig } from 'remotion';

export const TradingChart = ({
  patternType = 'bull_flag',
  trend = 'bullish',
  isShort = true
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const candles = [
    { open: 180, close: 240, high: 260, low: 160 },
    { open: 240, close: 320, high: 330, low: 230 },
    { open: 320, close: 410, high: 420, low: 300 },
    { open: 410, close: 370, high: 430, low: 360 },
    { open: 370, close: 340, high: 390, low: 330 },
    { open: 340, close: 360, high: 380, low: 330 },
    { open: 360, close: 330, high: 370, low: 320 },
    { open: 330, close: 420, high: 440, low: 325 },
    { open: 420, close: 510, high: 530, low: 410 },
    { open: 510, close: 590, high: 610, low: 490 }
  ];

  const chartW = isShort ? 920 : 1400;
  const chartH = isShort ? 800 : 650;
  const candleW = Math.floor(chartW / (candles.length + 2)) - 24;

  const visibleCandlesCount = Math.min(candles.length, Math.floor((frame / 12) + 1));

  return (
    <div
      style={{
        position: 'relative',
        width: chartW + 'px',
        height: chartH + 'px',
        background: 'radial-gradient(circle at 50% 30%, #0f172a 0%, #020617 100%)',
        borderRadius: '24px',
        border: '2px solid rgba(56, 189, 248, 0.35)',
        boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 40px rgba(34, 211, 238, 0.15)',
        overflow: 'hidden',
        padding: '30px'
      }}
    >
      <svg
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0.15 }}
      >
        <line x1="0" y1="25%" x2="100%" y2="25%" stroke="#38bdf8" strokeWidth="1" strokeDasharray="6,6" />
        <line x1="0" y1="50%" x2="100%" y2="50%" stroke="#38bdf8" strokeWidth="1" strokeDasharray="6,6" />
        <line x1="0" y1="75%" x2="100%" y2="75%" stroke="#38bdf8" strokeWidth="1" strokeDasharray="6,6" />
        <line x1="33%" y1="0" x2="33%" y2="100%" stroke="#38bdf8" strokeWidth="1" strokeDasharray="6,6" />
        <line x1="66%" y1="0" x2="66%" y2="100%" stroke="#38bdf8" strokeWidth="1" strokeDasharray="6,6" />
      </svg>

      <svg
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        viewBox={'0 0 ' + chartW + ' ' + chartH}
      >
        {candles.slice(0, visibleCandlesCount).map((c, i) => {
          const isGreen = c.close >= c.open;
          const color = isGreen ? '#22c55e' : '#ef4444';
          const x = 60 + i * (candleW + 28);
          const yOpen = chartH - c.open - 100;
          const yClose = chartH - c.close - 100;
          const yHigh = chartH - c.high - 100;
          const yLow = chartH - c.low - 100;
          const bodyY = Math.min(yOpen, yClose);
          const bodyH = Math.max(8, Math.abs(yClose - yOpen));

          return (
            <g key={i}>
              <line
                x1={x + candleW / 2}
                y1={yHigh}
                x2={x + candleW / 2}
                y2={yLow}
                stroke={color}
                strokeWidth="4"
                strokeLinecap="round"
              />
              <rect
                x={x}
                y={bodyY}
                width={candleW}
                height={bodyH}
                rx="4"
                fill={color}
                stroke={color}
                strokeWidth="2"
                style={{
                  filter: isGreen ? 'drop-shadow(0 0 10px rgba(34, 197, 94, 0.4))' : 'drop-shadow(0 0 10px rgba(239, 68, 68, 0.4))'
                }}
              />
            </g>
          );
        })}

        {frame > 35 && (
          <g>
            <line
              x1="320"
              y1={chartH - 430 - 100}
              x2="660"
              y2={chartH - 370 - 100}
              stroke="#facc15"
              strokeWidth="6"
              strokeDasharray="8,8"
            />
            <text x="340" y={chartH - 445 - 100} fill="#facc15" fontSize="22" fontWeight="bold" fontFamily="sans-serif">
              RESISTANCE TRENDLINE
            </text>
          </g>
        )}

        {frame > 65 && (
          <g>
            <circle cx="680" cy={chartH - 420 - 100} r="18" fill="#38bdf8" />
            <rect x="630" y={chartH - 485 - 100} width="160" height="42" rx="8" fill="#0284c7" stroke="#ffffff" strokeWidth="2" />
            <text x="710" y={chartH - 457 - 100} fill="#ffffff" fontSize="22" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">
              🚀 ENTRY
            </text>

            <rect x="760" y={chartH - 600 - 100} width="160" height="40" rx="8" fill="rgba(34, 197, 94, 0.85)" />
            <text x="840" y={chartH - 573 - 100} fill="#ffffff" fontSize="20" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">
              🎯 TARGET (1:3)
            </text>

            <rect x="760" y={chartH - 310 - 100} width="150" height="40" rx="8" fill="rgba(239, 68, 68, 0.85)" />
            <text x="835" y={chartH - 283 - 100} fill="#ffffff" fontSize="20" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">
              🛑 STOP LOSS
            </text>
          </g>
        )}
      </svg>
    </div>
  );
};
