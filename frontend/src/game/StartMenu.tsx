// The game's front door: a polished mode picker. Choosing Single Player drops
// you straight into flight; Multiplayer enters the online lobby flow. Pure DOM /
// CSS-in-JS (no 3D), so it mounts instantly before any heavy scene loads.

import { useState } from 'react'

export type GameMode = 'single' | 'multi'

export function StartMenu({ onPick }: { onPick: (mode: GameMode) => void }) {
  const [hover, setHover] = useState<GameMode | null>(null)

  return (
    <div style={root}>
      <style>{KEYFRAMES}</style>
      <div style={aurora} />

      <div style={content}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={title}>
            <span style={{ fontSize: '2.8rem', lineHeight: 1 }}>🦆</span>
            <span style={{ lineHeight: 1 }}>DucksFly</span>
          </div>
          <div style={subtitle}>Flap. Bank. Dive. Race through the rings.</div>
        </div>

        <div style={cardRow}>
          <ModeCard
            icon="🕹️"
            label="Single Player"
            blurb="Fly the course solo. Chase a clean run and a fast time."
            accent="#3b82f6"
            active={hover === 'single'}
            onEnter={() => setHover('single')}
            onLeave={() => setHover(null)}
            onClick={() => onPick('single')}
          />
          <ModeCard
            icon="🌐"
            label="Multiplayer"
            blurb="Join a lobby and race other ducks live through the same sky."
            accent="#f59e0b"
            active={hover === 'multi'}
            onEnter={() => setHover('multi')}
            onLeave={() => setHover(null)}
            onClick={() => onPick('multi')}
          />
        </div>

        <div style={footer}>SPACE flap · A / D lean · W dive</div>
      </div>
    </div>
  )
}

function ModeCard({
  icon,
  label,
  blurb,
  accent,
  active,
  onEnter,
  onLeave,
  onClick,
}: {
  icon: string
  label: string
  blurb: string
  accent: string
  active: boolean
  onEnter: () => void
  onLeave: () => void
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        ...card,
        transform: active ? 'translateY(-6px) scale(1.02)' : 'none',
        borderColor: active ? accent : 'rgba(120,150,180,0.25)',
        boxShadow: active
          ? `0 18px 50px rgba(0,0,0,0.45), 0 0 0 1px ${accent}, 0 0 40px -8px ${accent}`
          : '0 12px 32px rgba(0,0,0,0.35)',
      }}
    >
      <div
        style={{
          ...cardGlow,
          background: `radial-gradient(120px 120px at 50% 0%, ${accent}55, transparent 70%)`,
          opacity: active ? 1 : 0.35,
        }}
      />
      <div style={{ fontSize: '2.6rem', lineHeight: 1 }}>{icon}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 14, color: '#f3f8ff' }}>
        {label}
      </div>
      <div style={cardBlurb}>{blurb}</div>
      <div style={{ ...cardCta, color: accent }}>Play →</div>
    </button>
  )
}

const KEYFRAMES = `
@keyframes ducksfly-aurora {
  0%   { transform: translate3d(-10%, -10%, 0) rotate(0deg); }
  50%  { transform: translate3d(10%, 5%, 0) rotate(180deg); }
  100% { transform: translate3d(-10%, -10%, 0) rotate(360deg); }
}
@keyframes ducksfly-rise {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}`

const root: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'radial-gradient(140% 120% at 50% -10%, #16314f 0%, #0b1422 55%, #060b14 100%)',
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
}

const aurora: React.CSSProperties = {
  position: 'absolute',
  width: '90vmax',
  height: '90vmax',
  borderRadius: '45%',
  background:
    'conic-gradient(from 0deg, rgba(59,130,246,0.18), rgba(245,158,11,0.16), rgba(34,197,94,0.16), rgba(59,130,246,0.18))',
  filter: 'blur(60px)',
  animation: 'ducksfly-aurora 28s linear infinite',
  pointerEvents: 'none',
}

const content: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 34,
  padding: 24,
  animation: 'ducksfly-rise 0.5s ease both',
}

const title: React.CSSProperties = {
  fontSize: '2.6rem',
  fontWeight: 800,
  lineHeight: 1.1,
  letterSpacing: 0.5,
  color: '#eaf4ff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  textShadow: '0 4px 24px rgba(0,0,0,0.5)',
}

const subtitle: React.CSSProperties = {
  marginTop: 8,
  color: '#9fb3c8',
  fontSize: '1rem',
  letterSpacing: 0.3,
}

const cardRow: React.CSSProperties = {
  display: 'flex',
  gap: 24,
  flexWrap: 'wrap',
  justifyContent: 'center',
}

const card: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  width: 260,
  minHeight: 230,
  padding: '28px 24px',
  borderRadius: 18,
  border: '1px solid rgba(120,150,180,0.25)',
  background: 'linear-gradient(180deg, rgba(24,34,50,0.92), rgba(16,24,38,0.92))',
  color: '#dce8f5',
  cursor: 'pointer',
  textAlign: 'left',
  overflow: 'hidden',
  transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease',
}

const cardGlow: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  transition: 'opacity 0.18s ease',
  pointerEvents: 'none',
}

const cardBlurb: React.CSSProperties = {
  marginTop: 10,
  fontSize: '0.9rem',
  lineHeight: 1.5,
  color: '#9fb3c8',
}

const cardCta: React.CSSProperties = {
  marginTop: 'auto',
  paddingTop: 16,
  fontWeight: 700,
  fontSize: '0.95rem',
}

const footer: React.CSSProperties = {
  color: '#5f7a90',
  fontSize: '0.85rem',
  letterSpacing: 1,
  fontFamily: 'ui-monospace, monospace',
  opacity: 0.7,
}
