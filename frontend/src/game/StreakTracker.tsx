// Daily streak progress toward a 7-day mystery unlock. UI ONLY — streak math lives
// in flightStore (`getStreak()`); this component never recomputes days or qualifiers.
//
// Mounting: wire into the single-player submenu / finish screens during Task 5 (or
// after that merges) to avoid colliding on StartMenu.tsx with the main chain.

import { type CSSProperties } from 'react'
import { getStreak } from '../data/flightStore'
import { COLORS, FONT_BODY, FONT_DISPLAY, Panel, UI_KEYFRAMES } from './ui'

const GOAL_DAYS = 7

export function StreakTracker() {
  const { current } = getStreak()
  const unlocked = current >= GOAL_DAYS
  const remaining = unlocked ? 0 : Math.max(0, GOAL_DAYS - current)

  return (
    <Panel width={400} style={{ padding: '20px 24px' }}>
      <style>{UI_KEYFRAMES + STREAK_KEYFRAMES}</style>

      <div style={header}>
        <span style={headerTitle}>Daily streak</span>
        <span style={streakCount}>
          {current} day{current === 1 ? '' : 's'}
        </span>
      </div>

      <div style={pipRow} aria-label={`Streak progress: ${Math.min(current, GOAL_DAYS)} of ${GOAL_DAYS} days`}>
        {Array.from({ length: GOAL_DAYS - 1 }, (_, i) => {
          const day = i + 1
          const filled = current >= day
          return (
            <div
              key={day}
              style={{
                ...pip,
                ...(filled ? pipFilled : pipEmpty),
              }}
              title={filled ? `Day ${day} — flown` : `Day ${day}`}
            >
              {filled ? '✓' : day}
            </div>
          )
        })}
        <div
          style={{
            ...pip,
            ...pipMystery,
            ...(unlocked ? pipMysteryUnlocked : pipMysteryLocked),
          }}
          title={unlocked ? 'Mystery reward unlocked' : 'Mystery reward — day 7'}
        >
          {unlocked ? '✨' : '???'}
        </div>
      </div>

      <p style={copy}>
        {unlocked ? (
          <>
            <strong style={{ color: COLORS.orangeDeep }}>Unlocked!</strong> Something mysterious
            awaits — what could it be?
          </>
        ) : (
          <>
            <span style={mysteryLock}>🔒 ???</span>
            {' — '}
            fly {remaining} more day{remaining === 1 ? '' : 's'} to reveal
          </>
        )}
      </p>

      {!unlocked && (
        <p style={hint}>Qualifying run: fly 2 km+ or finish a race (any mode).</p>
      )}
    </Panel>
  )
}

// Subtle glow on the locked mystery pip; celebratory pulse when unlocked.
const STREAK_KEYFRAMES = `
@keyframes ducksfly-mystery-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(254, 225, 35, 0.35); }
  50%      { box-shadow: 0 0 14px 4px rgba(254, 225, 35, 0.55); }
}
@keyframes ducksfly-mystery-unlock {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.06); }
}`

const header: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 14,
}

const headerTitle: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontWeight: 600,
  fontSize: '1.05rem',
  color: COLORS.slate,
}

const streakCount: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontWeight: 700,
  fontSize: '1.2rem',
  color: COLORS.orangeDeep,
}

const pipRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  marginBottom: 14,
}

const pip: CSSProperties = {
  width: 40,
  height: 40,
  display: 'grid',
  placeItems: 'center',
  fontFamily: FONT_DISPLAY,
  fontWeight: 700,
  fontSize: '0.85rem',
  borderRadius: 8,
  border: `1px solid ${COLORS.lineD}`,
  userSelect: 'none',
}

const pipEmpty: CSSProperties = {
  background: '#fff',
  color: COLORS.slateDim,
}

const pipFilled: CSSProperties = {
  background: `linear-gradient(180deg, ${COLORS.green}, ${COLORS.greenDeep})`,
  color: '#fff',
  border: 'none',
}

const pipMystery: CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: 0.5,
}

const pipMysteryLocked: CSSProperties = {
  background: 'linear-gradient(145deg, #2a3540 0%, #1a2430 100%)',
  color: COLORS.yellow,
  border: `2px solid ${COLORS.yellow}`,
  animation: 'ducksfly-mystery-glow 2.4s ease-in-out infinite',
}

const pipMysteryUnlocked: CSSProperties = {
  background: `linear-gradient(180deg, ${COLORS.yellow}, ${COLORS.yellowDeep})`,
  color: COLORS.slate,
  border: `2px solid ${COLORS.orangeDeep}`,
  fontSize: '1.1rem',
  animation: 'ducksfly-mystery-unlock 1.8s ease-in-out infinite',
}

const copy: CSSProperties = {
  margin: 0,
  fontFamily: FONT_BODY,
  fontSize: '0.95rem',
  lineHeight: 1.45,
  color: COLORS.slate,
  textAlign: 'center',
}

const mysteryLock: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontWeight: 600,
  color: COLORS.orangeDeep,
}

const hint: CSSProperties = {
  margin: '10px 0 0',
  fontSize: '0.78rem',
  color: COLORS.slateDim,
  textAlign: 'center',
  lineHeight: 1.4,
}
