import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'AI Refill — Optimización Inteligente de Inventarios';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Box icon (Lucide) */}
        <svg
          width="120"
          height="120"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#10b981"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
          <path d="m3.3 7 8.7 5 8.7-5" />
          <path d="M12 22V12" />
        </svg>

        {/* Title */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginTop: 32,
          }}
        >
          <div
            style={{
              fontSize: 64,
              fontWeight: 700,
              color: '#f8fafc',
              letterSpacing: '-0.02em',
            }}
          >
            AI Refill
          </div>
          <div
            style={{
              fontSize: 28,
              color: '#94a3b8',
              marginTop: 12,
            }}
          >
            Optimización Inteligente de Inventarios
          </div>
        </div>

        {/* Tagline */}
        <div
          style={{
            display: 'flex',
            gap: 24,
            marginTop: 40,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: '#3b82f6',
              fontSize: 18,
            }}
          >
            <div style={{ width: 8, height: 8, borderRadius: 4, background: '#3b82f6' }} />
            Predicción de Demanda
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: '#10b981',
              fontSize: 18,
            }}
          >
            <div style={{ width: 8, height: 8, borderRadius: 4, background: '#10b981' }} />
            Reabastecimiento Inteligente
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: '#f59e0b',
              fontSize: 18,
            }}
          >
            <div style={{ width: 8, height: 8, borderRadius: 4, background: '#f59e0b' }} />
            Análisis en Tiempo Real
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
