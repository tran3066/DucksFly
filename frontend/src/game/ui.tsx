// Shared UI kit for the game's overlays (lobby, results, finish, HUD). Matches the polished
// look of StartMenu — dark glass panels, soft glows, a clean sans-serif — so nothing in the
// shipped game falls back to the old monospace debug-harness styling.

import { type CSSProperties, type ReactNode } from 'react'

export const FONT =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

export const COLORS = {
  text: '#eaf4ff',
  dim: '#9fb3c8',
  faint: '#5f7a90',
  accent: '#f59e0b',
  accentBlue: '#3b82f6',
  good: '#5fe08a',
  bad: '#ff8a8a',
  gold: '#ffd23f',
}

/** Full-screen dim backdrop that centers its content. */
export function Overlay({
  children,
  dim = 0.62,
  blockPointer = true,
}: {
  children: ReactNode
  dim?: number
  blockPointer?: boolean
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: `radial-gradient(120% 100% at 50% 0%, rgba(13,24,40,${dim * 0.7}), rgba(6,11,20,${dim}))`,
        color: COLORS.text,
        fontFamily: FONT,
        pointerEvents: blockPointer ? 'auto' : 'none',
        animation: 'ducksfly-rise 0.35s ease both',
      }}
    >
      {children}
    </div>
  )
}

/** Glassy card. */
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
        padding: '26px 28px',
        borderRadius: 18,
        border: '1px solid rgba(120,150,180,0.25)',
        background: 'linear-gradient(180deg, rgba(24,34,50,0.94), rgba(14,21,34,0.94))',
        boxShadow: '0 24px 70px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(10px)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export type ButtonVariant = 'primary' | 'ghost' | 'danger'

export function Button({
  children,
  onClick,
  disabled,
  variant = 'ghost',
  type = 'button',
  accent = COLORS.accent,
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
  const base: CSSProperties = {
    padding: '10px 18px',
    borderRadius: 10,
    fontFamily: FONT,
    fontSize: '0.95rem',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    transition: 'transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease',
    border: '1px solid transparent',
    color: COLORS.text,
  }
  const variants: Record<ButtonVariant, CSSProperties> = {
    primary: {
      background: accent,
      color: '#0b1422',
      boxShadow: `0 8px 24px -6px ${accent}`,
    },
    ghost: {
      background: 'rgba(255,255,255,0.06)',
      borderColor: 'rgba(140,170,200,0.3)',
    },
    danger: {
      background: 'rgba(255,120,120,0.08)',
      borderColor: 'rgba(255,120,120,0.4)',
      color: '#ffc1c1',
    },
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{ ...base, ...variants[variant], ...style }}
    >
      {children}
    </button>
  )
}

/** Text input that matches the panel styling. */
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
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid rgba(140,170,200,0.28)',
        background: 'rgba(10,16,28,0.6)',
        color: COLORS.text,
        fontFamily: FONT,
        fontSize: '0.95rem',
        outline: 'none',
        textTransform: uppercase ? 'uppercase' : 'none',
        letterSpacing: uppercase ? 4 : undefined,
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

/** Keyboard key cap for control hints. */
export function KeyCap({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-block',
        minWidth: 18,
        padding: '2px 7px',
        margin: '0 3px',
        borderRadius: 6,
        background: 'rgba(255,255,255,0.14)',
        border: '1px solid rgba(255,255,255,0.28)',
        fontFamily: MONO,
        fontSize: '0.8rem',
        textAlign: 'center',
      }}
    >
      {children}
    </span>
  )
}

/** Shared keyframes for overlay entrance (mirrors StartMenu's rise). */
export const UI_KEYFRAMES = `
@keyframes ducksfly-rise {
  from { opacity: 0; transform: translateY(14px); }
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
}`
