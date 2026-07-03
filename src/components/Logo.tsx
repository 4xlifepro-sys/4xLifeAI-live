import React from 'react';

interface LogoProps {
  size?: number | string;
  className?: string;
  showText?: boolean;
}

export const Logo: React.FC<LogoProps> = ({ size = 32, className, showText = false }) => {
  return (
    <div className={`flex items-center gap-2 ${className || ''}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="rounded-2xl"
      >
        {/* Background Gradient */}
        <defs>
          <radialGradient id="logoBg" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="#0B429F" />
            <stop offset="50%" stopColor="#061F5C" />
            <stop offset="100%" stopColor="#03081A" />
          </radialGradient>
          
          <linearGradient id="glowGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#003BFF" stopOpacity="0" />
            <stop offset="50%" stopColor="#00F0FF" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#00F0FF" stopOpacity="0" />
          </linearGradient>

          <linearGradient id="candleUp" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#00F0FF" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#003BFF" stopOpacity="0.05" />
          </linearGradient>

          <linearGradient id="candleDown" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#003BFF" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#001040" stopOpacity="0.05" />
          </linearGradient>
          
          <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="blur1" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur2" />
            <feMerge>
              <feMergeNode in="blur1" />
              <feMergeNode in="blur2" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Rounded base background */}
        <rect width="512" height="512" fill="url(#logoBg)" rx="110" />

        {/* Candlestick chart elements in background */}
        {/* Left side candles (smaller, lower) */}
        <g opacity="0.18">
          {/* Candle 1 */}
          <line x1="45" y1="360" x2="45" y2="440" stroke="#003BFF" strokeWidth="2" />
          <rect x="37" y="380" width="16" height="40" fill="url(#candleDown)" rx="2" />
          
          {/* Candle 2 */}
          <line x1="75" y1="320" x2="75" y2="420" stroke="#00F0FF" strokeWidth="2" />
          <rect x="67" y="340" width="16" height="50" fill="url(#candleUp)" rx="2" />

          {/* Candle 3 */}
          <line x1="105" y1="300" x2="105" y2="390" stroke="#00F0FF" strokeWidth="2" />
          <rect x="97" y="315" width="16" height="45" fill="url(#candleUp)" rx="2" />

          {/* Candle 4 */}
          <line x1="135" y1="330" x2="135" y2="400" stroke="#003BFF" strokeWidth="2" />
          <rect x="127" y="350" width="16" height="35" fill="url(#candleDown)" rx="2" />
        </g>

        {/* Right side candles (rising upwards) */}
        <g opacity="0.22">
          {/* Candle 5 */}
          <line x1="395" y1="180" x2="395" y2="280" stroke="#00F0FF" strokeWidth="2" />
          <rect x="387" y="200" width="16" height="60" fill="url(#candleUp)" rx="2" />

          {/* Candle 6 */}
          <line x1="425" y1="120" x2="425" y2="220" stroke="#00F0FF" strokeWidth="2" />
          <rect x="417" y="140" width="16" height="55" fill="url(#candleUp)" rx="2" />

          {/* Candle 7 */}
          <line x1="455" y1="80" x2="455" y2="180" stroke="#00F0FF" strokeWidth="2" />
          <rect x="447" y="95" width="16" height="60" fill="url(#candleUp)" rx="2" />

          {/* Candle 8 */}
          <line x1="485" y1="50" x2="485" y2="150" stroke="#00F0FF" strokeWidth="2" />
          <rect x="477" y="60" width="16" height="65" fill="url(#candleUp)" rx="2" />
        </g>

        {/* Diagonal glowing beam */}
        <path
          d="M -30 460 L 460 -30"
          stroke="url(#glowGrad)"
          strokeWidth="32"
          strokeLinecap="round"
          filter="url(#neonGlow)"
        />

        {/* High-tech grid line intersection */}
        <line x1="0" y1="400" x2="512" y2="400" stroke="#ffffff" strokeOpacity="0.03" strokeWidth="1" />
        <line x1="400" y1="0" x2="400" y2="512" stroke="#ffffff" strokeOpacity="0.03" strokeWidth="1" />
        
        {/* Main "4X" text elements */}
        {/* The geometric "4" */}
        <path
          d="M 235 135 L 75 320 L 235 320 L 235 385 L 285 385 L 285 320 L 320 320 L 320 275 L 285 275 L 285 135 Z M 235 195 L 235 275 L 165 275 Z"
          fill="#FFFFFF"
          fillRule="evenodd"
        />

        {/* The geometric "X" */}
        {/* Main diagonal 1 */}
        <polygon
          points="275,385 450,135 500,135 325,385"
          fill="#FFFFFF"
        />
        {/* Main diagonal 2 */}
        <polygon
          points="450,385 275,135 325,135 500,385"
          fill="#FFFFFF"
        />
      </svg>
      {showText && (
        <span className="font-semibold text-lg tracking-tight text-white font-sans">4xLifeAI</span>
      )}
    </div>
  );
};
