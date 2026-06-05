// The game's front door: a polished mode picker. Choosing Single Player drops
// you straight into flight; Multiplayer enters the online lobby flow. Pure DOM /
// CSS-in-JS (no 3D), so it mounts instantly before any heavy scene loads.

import { useState } from 'react'
import {
  BrandMark,
  Button,
  COLORS,
  FONT_BODY,
  FONT_DISPLAY,
  KeyCap,
  SHADOW,
  TextInput,
  UI_KEYFRAMES,
  cutPath,
} from './ui'
import { StatsScreen } from './StatsScreen'
import { getPlayerName, setPlayerName } from '../data/flightStore'

export type GameMode = 'race-setup' | 'race' | 'infinite' | 'multi'

export function StartMenu({ onPick }: { onPick: (mode: GameMode) => void }) {
  const [hover, setHover] = useState<GameMode | null>(null)
  const [hoverSolo, setHoverSolo] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [view, setView] = useState<'main' | 'solo'>('main')

  if (view === 'solo') {
    return (
      <div style={root}>
        <style>{UI_KEYFRAMES}</style>
        <SkyBackdrop />
        <NameBadge />
        <div style={topBar}>
          <Button variant="ghost" onClick={() => setShowStats(true)}>
            📊 Lifetime stats
          </Button>
        </div>
        <div style={content}>
          <div style={{ textAlign: 'center', animation: 'ducksfly-rise 0.5s both' }}>
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 700,
                fontSize: '2rem',
                color: '#fff',
                textShadow: '0 2px 8px rgba(20,40,60,0.4)',
                marginBottom: 8,
              }}
            >
              Single Player
            </div>
            <div style={tagline}>Race a set distance, or fly until you crash.</div>
          </div>
          <div style={cardRow}>
            <ModeCard
              icon="🏁"
              label="Race"
              blurb="Pick your distance (1 km – 50 km). Chase a fast time and clean rings."
              accent={COLORS.cyanDeep}
              iconBg="rgba(41,194,232,0.16)"
              delay={0.16}
              active={hover === 'race-setup'}
              onEnter={() => setHover('race-setup')}
              onLeave={() => setHover(null)}
              onClick={() => onPick('race-setup')}
            />
            <ModeCard
              icon="∞"
              label="Infinite Run"
              blurb="The course never ends. Fly as far as you can — one crash ends the run."
              accent={COLORS.orangeDeep}
              iconBg="rgba(255,138,31,0.16)"
              delay={0.24}
              active={hover === 'infinite'}
              onEnter={() => setHover('infinite')}
              onLeave={() => setHover(null)}
              onClick={() => onPick('infinite')}
            />
          </div>
          <div style={{ animation: 'ducksfly-rise 0.5s 0.32s both' }}>
            <Button variant="ghost" onClick={() => setView('main')}>
              ← Back to menu
            </Button>
          </div>
        </div>
        {showStats && <StatsScreen onClose={() => setShowStats(false)} />}
      </div>
    )
  }

  return (
    <div style={root}>
      <style>{UI_KEYFRAMES}</style>
      <SkyBackdrop />
      <NameBadge />

      <div style={topBar}>
        <Button variant="ghost" onClick={() => setShowStats(true)}>
          📊 Lifetime stats
        </Button>
      </div>

      <div style={content}>
        <div style={{ textAlign: 'center', animation: 'ducksfly-rise 0.5s both' }}>
          <BrandMark />
          <div style={tagline}>Flap. Bank. Dive. Race through the rings.</div>
        </div>

        <div style={cardRow}>
          <ModeCard
            icon="🕹️"
            label="Single Player"
            blurb="Fly the course solo. Chase a clean run and a fast time."
            accent={COLORS.cyanDeep}
            iconBg="rgba(41,194,232,0.16)"
            delay={0.16}
            active={hoverSolo}
            onEnter={() => setHoverSolo(true)}
            onLeave={() => setHoverSolo(false)}
            onClick={() => setView('solo')}
          />
          <ModeCard
            icon="🌐"
            label="Multiplayer"
            blurb="Join a lobby and race other ducks live through the same sky."
            accent={COLORS.orangeDeep}
            iconBg="rgba(255,138,31,0.16)"
            delay={0.24}
            active={hover === 'multi'}
            onEnter={() => setHover('multi')}
            onLeave={() => setHover(null)}
            onClick={() => onPick('multi')}
          />
        </div>

        <div style={{ ...hints, animation: 'ducksfly-rise 0.5s 0.32s both' }}>
          <span style={hintGroup}>
            <KeyCap>Space</KeyCap> flap
          </span>
          <span style={hintDot}>·</span>
          <span style={hintGroup}>
            <KeyCap>A</KeyCap>/<KeyCap>D</KeyCap> lean
          </span>
          <span style={hintDot}>·</span>
          <span style={hintGroup}>
            <KeyCap>W</KeyCap> dive
          </span>
        </div>
      </div>

      {showStats && <StatsScreen onClose={() => setShowStats(false)} />}
    </div>
  )
}

function ModeCard({
  icon,
  label,
  blurb,
  accent,
  iconBg,
  delay,
  active,
  onEnter,
  onLeave,
  onClick,
}: {
  icon: string
  label: string
  blurb: string
  accent: string
  iconBg: string
  delay: number
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
        transform: active ? 'translateY(-4px)' : 'none',
        boxShadow: active
          ? '0 28px 50px -20px rgba(20,40,60,0.55)'
          : SHADOW,
        animation: `ducksfly-rise 0.5s ${delay}s both`,
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          clipPath: cutPath(),
          background: 'linear-gradient(160deg, rgba(255,255,255,0.6), transparent 38%)',
        }}
      />
      <div style={{ position: 'relative' }}>
        <div style={{ ...iconWrap, background: iconBg }}>{icon}</div>
        <div style={cardTitle}>{label}</div>
        <div style={cardBlurb}>{blurb}</div>
        <span style={{ ...cardCta, color: accent }}>Play →</span>
      </div>
    </button>
  )
}

/** Top-left "Hi, {name}" greeting with an inline editor. The name persists via
 *  the player profile (the same identity the stats + multiplayer lobby read). */
function NameBadge() {
  const [name, setName] = useState(() => getPlayerName())
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  const commit = () => {
    const next = draft.trim()
    if (next) {
      setPlayerName(next)
      setName(next)
    } else {
      setDraft(name)
    }
    setEditing(false)
  }

  return (
    <div style={nameBadge}>
      {editing ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <TextInput
            value={draft}
            onChange={setDraft}
            maxLength={20}
            placeholder="Your name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(name)
                setEditing(false)
              }
            }}
            style={{ padding: '7px 11px', fontSize: '0.9rem' }}
          />
          <Button variant="primary" onClick={commit} style={{ padding: '7px 14px' }}>
            Save
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(name)
            setEditing(true)
          }}
          style={nameButton}
          title="Change your name"
        >
          <span style={{ color: '#fff', opacity: 0.85 }}>Hi,</span>
          <span style={{ color: '#fff', fontWeight: 700 }}>{name}</span>
          <span style={{ opacity: 0.7, fontSize: '0.85rem' }}>✏️</span>
        </button>
      )}
    </div>
  )
}

/** Static low-poly sky backdrop behind the menu (gradient + cloud silhouettes). */
function SkyBackdrop() {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        background:
          'linear-gradient(180deg, #7ec8ff 0%, #b6dcf6 45%, #d7f0fb 62%, #c0d4cd 70%, #8fcb6b 82%, #5e9e58 100%)',
        pointerEvents: 'none',
      }}
    />
  )
}

const root: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: FONT_BODY,
  color: COLORS.slate,
}

const topBar: React.CSSProperties = {
  position: 'absolute',
  top: 18,
  right: 18,
  zIndex: 2,
}

const nameBadge: React.CSSProperties = {
  position: 'absolute',
  top: 18,
  left: 18,
  zIndex: 2,
}

const nameButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  padding: '9px 15px',
  background: 'rgba(20,40,60,0.32)',
  border: '1px solid rgba(255,255,255,0.28)',
  borderRadius: 999,
  cursor: 'pointer',
  fontFamily: FONT_DISPLAY,
  fontSize: '1rem',
  textShadow: '0 1px 4px rgba(20,40,60,0.4)',
  backdropFilter: 'blur(4px)',
}

const content: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 30,
  padding: 24,
}

const tagline: React.CSSProperties = {
  marginTop: 10,
  textAlign: 'center',
  fontFamily: FONT_DISPLAY,
  fontWeight: 500,
  fontSize: '1.15rem',
  color: '#fff',
  textShadow: '0 2px 8px rgba(20,40,60,0.4)',
}

const cardRow: React.CSSProperties = {
  display: 'flex',
  gap: 20,
  flexWrap: 'wrap',
  justifyContent: 'center',
}

const card: React.CSSProperties = {
  position: 'relative',
  width: 330,
  padding: 26,
  background: COLORS.cream,
  border: `1px solid ${COLORS.lineD}`,
  clipPath: cutPath(),
  color: COLORS.slate,
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'transform 0.18s ease, box-shadow 0.2s ease',
  fontFamily: FONT_BODY,
}

const iconWrap: React.CSSProperties = {
  width: 54,
  height: 54,
  display: 'grid',
  placeItems: 'center',
  fontSize: 30,
  marginBottom: 16,
  clipPath: cutPath(8),
}

const cardTitle: React.CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontWeight: 600,
  fontSize: '1.55rem',
  marginBottom: 9,
  color: COLORS.slate,
}

const cardBlurb: React.CSSProperties = {
  color: COLORS.slateDim,
  fontWeight: 500,
  lineHeight: 1.5,
  marginBottom: 22,
  minHeight: 66,
  fontSize: '0.95rem',
}

const cardCta: React.CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontWeight: 600,
  fontSize: '1.1rem',
}

const hints: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 9,
  fontWeight: 600,
  color: COLORS.slateDim,
  fontSize: '0.95rem',
  textShadow: '0 1px 2px rgba(255,255,255,0.4)',
}

const hintGroup: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
}

const hintDot: React.CSSProperties = {
  color: COLORS.slateDim,
  opacity: 0.5,
}
