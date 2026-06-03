// Shared low-poly UI kit (matches frontend/design_prototype/ducksfly-ui-new.html).
// Bright cream panels for menus/calibration/finish; dark navy HUD panels for in-flight
// overlays. Chamfered corners via `clip-path`, "pressed" button shadow, Fredoka/Outfit/
// JetBrains Mono fonts (loaded in index.html).

import { type CSSProperties, type ReactNode } from 'react'

export const FONT_DISPLAY = '"Fredoka", system-ui, -apple-system, sans-serif'
export const FONT_BODY = '"Outfit", system-ui, -apple-system, sans-serif'
export const FONT_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace'

// Legacy names kept so existing call sites keep working.
export const FONT = FONT_BODY
export const MONO = FONT_MONO

// Low-poly UI palette. Brand accent is University of Oregon green (#154733) with
// UO yellow (#FEE123) as a secondary pop. The legacy `orange*` token names are kept
// (and mapped to UO green) so existing call sites don't need to change.
export const COLORS = {
  // Brand primary — UO green. `orange`/`orangeDeep` names kept for back-compat.
  orange: '#2c8a4f',
  orangeDeep: '#154733',
  // UO secondary — yellow.
  yellow: '#fee123',
  yellowDeep: '#e6c800',
  cyan: '#29c2e8',
  cyanDeep: '#15a6cc',
  green: '#2c8a4f',
  greenDeep: '#154733',

  // Bright panels
  slate: '#20303f',
  slateDim: '#5e7184',
  cream: '#f4f9fd',
  lineD: 'rgba(32,48,63,0.12)',
  skyWash: '#bfe1f7',

  // Dark HUD panels
  hud: 'rgba(16,27,38,0.72)',
  hudLine: 'rgba(180,225,255,0.2)',
  hudText: '#eaf6ff',
  hudDim: '#9fc0d4',

  // ---- Legacy aliases (so previously written screens keep compiling) ----
  text: '#20303f', // body text on bright panels (was '#eaf4ff')
  dim: '#5e7184',
  faint: '#8a9aab',
  accent: '#154733', // primary CTA color (UO green)
  accentBlue: '#29c2e8', // solo / camera accent
  good: '#2c8a4f',
  bad: '#ff5c5c',
  gold: '#fee123', // UO yellow for stat / collectible highlights
} as const

export const RADIUS = 13

// Chamfered-corner clip-path with a 13px corner cut. Reuse on every panel/button so
// the low-poly look stays consistent. Accepts a custom radius for compact chips.
export function cutPath(r: number = RADIUS): string {
  return `polygon(0 ${r}px, ${r}px 0, 100% 0, 100% calc(100% - ${r}px), calc(100% - ${r}px) 100%, 0 100%)`
}

export const SHADOW = '0 20px 44px -20px rgba(20,40,60,0.5)'

/** Full-screen sky-wash backdrop that centers its content (bright surface flows). */
export function Overlay({
  children,
  dim = 0.62,
  blockPointer = true,
}: {
  children: ReactNode
  dim?: number
  blockPointer?: boolean
}) {
  // `dim` is kept for API compatibility but the low-poly UI uses a bright sky wash
  // instead of a dark veil. A higher value just tints the wash slightly cooler.
  const tint = Math.min(0.18, dim * 0.18)
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 40px 40px',
        background: `linear-gradient(180deg, ${COLORS.skyWash} 0%, #d6ecf9 60%, rgba(159,182,201,${0.4 + tint}) 100%)`,
        color: COLORS.slate,
        fontFamily: FONT_BODY,
        pointerEvents: blockPointer ? 'auto' : 'none',
        animation: 'ducksfly-rise 0.5s cubic-bezier(0.2,0.7,0.3,1) both',
      }}
    >
      {children}
    </div>
  )
}

/** Bright cream "card" panel with chamfered corners + soft gloss. */
export function Panel({
  children,
  style,
  width = 460,
}: {
  children: ReactNode
  style?: CSSProperties
  width?: number
}) {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: width,
        padding: '28px 32px',
        background: COLORS.cream,
        border: `1px solid ${COLORS.lineD}`,
        clipPath: cutPath(),
        boxShadow: SHADOW,
        color: COLORS.slate,
        fontFamily: FONT_BODY,
        ...style,
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
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  )
}

/** Dark translucent HUD panel for chrome over the live 3D scene. */
export function HudPanel({
  children,
  style,
}: {
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <div
      style={{
        background: COLORS.hud,
        border: `1px solid ${COLORS.hudLine}`,
        clipPath: cutPath(),
        color: COLORS.hudText,
        backdropFilter: 'blur(7px)',
        WebkitBackdropFilter: 'blur(7px)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'cyan'

export function Button({
  children,
  onClick,
  disabled,
  variant = 'ghost',
  type = 'button',
  accent,
  style,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: ButtonVariant
  type?: 'button' | 'submit'
  accent?: string
  style?: CSSProperties
}) {
  // Legacy callers pass `accent` to recolor a "primary" CTA. Map the most common
  // hand-rolled accents to the new variants so existing code keeps reading well.
  let v: ButtonVariant = variant
  let accentOverride: { from: string; to: string } | null = null
  if (variant === 'primary' && accent) {
    if (accent === COLORS.cyan || accent === COLORS.cyanDeep || accent === '#3b82f6') {
      v = 'cyan'
    } else if (accent === COLORS.green || accent === '#5fe08a') {
      accentOverride = { from: COLORS.green, to: COLORS.greenDeep }
    } else if (accent !== COLORS.orange && accent !== COLORS.accent) {
      accentOverride = { from: accent, to: accent }
    }
  }

  const base: CSSProperties = {
    fontFamily: FONT_DISPLAY,
    fontWeight: 600,
    fontSize: '1rem',
    padding: '13px 24px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    border: 'none',
    color: '#fff',
    letterSpacing: '0.01em',
    clipPath: cutPath(),
    boxShadow: '0 6px 0 rgba(20,40,60,0.18)',
    transition: 'transform 0.1s ease, filter 0.18s ease',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  }
  const variants: Record<ButtonVariant, CSSProperties> = {
    primary: {
      background: `linear-gradient(180deg, ${COLORS.orange}, ${COLORS.orangeDeep})`,
    },
    cyan: {
      background: `linear-gradient(180deg, ${COLORS.cyan}, ${COLORS.cyanDeep})`,
    },
    ghost: {
      background: '#fff',
      color: COLORS.slate,
      border: `1px solid ${COLORS.lineD}`,
      boxShadow: '0 5px 0 rgba(20,40,60,0.12)',
    },
    danger: {
      background: `linear-gradient(180deg, #ff7c7c, #d94f4f)`,
    },
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseDown={(e) => {
        if (!disabled) (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(4px)'
      }}
      onMouseUp={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.transform = 'none'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.transform = 'none'
      }}
      style={{
        ...base,
        ...variants[v],
        ...(accentOverride
          ? { background: `linear-gradient(180deg, ${accentOverride.from}, ${accentOverride.to})` }
          : {}),
        ...style,
      }}
    >
      {children}
    </button>
  )
}

/** Text input that matches the bright-panel styling. */
export function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
  maxLength,
  style,
  onKeyDown,
  uppercase,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  maxLength?: number
  style?: CSSProperties
  onKeyDown?: (e: React.KeyboardEvent) => void
  uppercase?: boolean
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      style={{
        padding: '11px 14px',
        border: `1px solid ${COLORS.lineD}`,
        background: '#fff',
        color: COLORS.slate,
        fontFamily: uppercase ? FONT_MONO : FONT_BODY,
        fontSize: '0.95rem',
        outline: 'none',
        clipPath: cutPath(8),
        textTransform: uppercase ? 'uppercase' : 'none',
        letterSpacing: uppercase ? 6 : undefined,
        boxShadow: 'inset 0 2px 0 rgba(20,40,60,0.06)',
        ...style,
      }}
    />
  )
}

/** Format an elapsed duration (ms) as "12.3s" or "1:04.2". */
export function formatTime(ms: number): string {
  if (!ms || ms < 0) return '—'
  const totalSec = ms / 1000
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`
  const m = Math.floor(totalSec / 60)
  const s = totalSec - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

/** Chamfered keyboard key cap for control hints. */
export function KeyCap({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        minWidth: 18,
        padding: '4px 10px',
        margin: '0 3px',
        background: dark ? 'rgba(255,255,255,0.12)' : '#fff',
        color: dark ? COLORS.hudText : COLORS.slate,
        border: `1px solid ${dark ? COLORS.hudLine : COLORS.lineD}`,
        fontFamily: FONT_MONO,
        fontWeight: 500,
        fontSize: '0.8rem',
        textAlign: 'center',
        clipPath: cutPath(4),
        boxShadow: dark ? 'none' : '0 2px 0 rgba(20,40,60,0.12)',
      }}
    >
      {children}
    </span>
  )
}

/** Low-poly duck mark SVG used beside the brand wordmark. */
export function DuckMark({ size = 62 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 200 150"
      width={size}
      height={(size * 150) / 200}
      style={{ filter: 'drop-shadow(0 8px 10px rgba(20,40,60,0.25))', flexShrink: 0 }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <polygon points="42,86 54,112 26,98" fill="#7c828c" />
      <polygon points="86,92 42,86 70,68" fill="#9aa0a8" />
      <polygon points="86,92 70,68 112,76" fill="#aab0b8" />
      <polygon points="86,92 112,76 126,102" fill="#878d96" />
      <polygon points="86,92 126,102 90,122" fill="#9aa0a8" />
      <polygon points="86,92 90,122 54,112" fill="#787e88" />
      <polygon points="86,92 54,112 42,86" fill="#8d939c" />
      <polygon points="70,74 108,70 90,100" fill="#5d636d" />
      <polygon points="70,74 90,100 78,92" fill="#4e545e" />
      <polygon points="80,88 104,84 96,96" fill="#3a6e9c" />
      <polygon points="132,24 156,40 152,64 132,72 116,56 118,34" fill="#2e8a52" />
      <polygon points="132,24 118,34 116,56 132,72" fill="#226b41" />
      <polygon points="126,60 150,60 138,72" fill="#cfd4da" />
      <polygon points="156,44 190,50 156,60" fill="#e7a82c" />
      <polygon points="156,52 184,55 156,60" fill="#cf9420" />
      <polygon points="139,40 145,43 142,48 137,45" fill="#15242b" />
    </svg>
  )
}

/** "Ducks Fly" brand wordmark with low-poly duck. */
export function BrandMark({ size = 'lg' }: { size?: 'lg' | 'md' }) {
  const duckPx = size === 'lg' ? 62 : 44
  const titlePx = size === 'lg' ? '3.4rem' : '2.4rem'
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
      }}
    >
      <DuckMark size={duckPx} />
      <h1
        style={{
          margin: 0,
          fontFamily: FONT_DISPLAY,
          fontWeight: 700,
          fontSize: titlePx,
          color: '#fff',
          letterSpacing: '-0.01em',
          textShadow: '0 3px 0 rgba(32,64,96,0.25), 0 8px 20px rgba(20,40,60,0.3)',
        }}
      >
        Ducks<span style={{ color: COLORS.yellow }}>Fly</span>
      </h1>
    </div>
  )
}

/** Shared keyframes for overlay entrance, pop, and flash animations. */
export const UI_KEYFRAMES = `
@keyframes ducksfly-rise {
  from { opacity: 0; transform: translateY(15px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes ducksfly-pop {
  0%   { transform: scale(0.6); opacity: 0; }
  60%  { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1); }
}
@keyframes ducksfly-flash {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.3; }
}
@keyframes ducksfly-bobv {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(5px); }
}`
