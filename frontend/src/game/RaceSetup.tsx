// Pre-race distance picker for solo Race mode. Presets + custom input, clamped
// to [1000, 50000] m (default 2000). Shows the per-distance PB for the active
// control mode before the player launches.

import { useMemo, useState } from 'react'
import { getRacePB, type Control } from '../data/flightStore'
import type { ControlMode } from './ModeChooser'
import {
  Button,
  COLORS,
  FONT_BODY,
  FONT_DISPLAY,
  FONT_MONO,
  Overlay,
  Panel,
  UI_KEYFRAMES,
  cutPath,
  formatTime,
} from './ui'
import {
  RACE_DIST_DEFAULT,
  RACE_DIST_MAX,
  RACE_DIST_MIN,
  RACE_DIST_PRESETS,
  clampRaceDistance,
  formatRaceDistance,
} from './raceDistance'

export function RaceSetup({
  controlMode,
  onStart,
  onBack,
}: {
  controlMode: ControlMode
  onStart: (targetDist: number) => void
  onBack: () => void
}) {
  const [targetDist, setTargetDist] = useState(RACE_DIST_DEFAULT)
  const [custom, setCustom] = useState(String(RACE_DIST_DEFAULT))

  const control: Control = controlMode === 'camera' ? 'cam' : 'kb' // 'choose' → kb until picked
  const pb = useMemo(() => getRacePB(targetDist, control), [targetDist, control])

  const applyPreset = (m: number) => {
    setTargetDist(m)
    setCustom(String(m))
  }

  const applyCustom = () => {
    const next = clampRaceDistance(Number(custom))
    setTargetDist(next)
    setCustom(String(next))
  }

  return (
    <div style={{ position: 'fixed', inset: 0, fontFamily: FONT_BODY }}>
      <style>{UI_KEYFRAMES}</style>
      <Overlay dim={0.55}>
        <Panel width={480} style={{ padding: '32px 36px' }}>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: '1.85rem',
              fontWeight: 700,
              color: COLORS.slate,
              marginBottom: 6,
            }}
          >
            Race distance
          </div>
          <p style={{ color: COLORS.slateDim, margin: '0 0 22px', lineHeight: 1.5 }}>
            Pick how far you fly. Crash respawns at the last checkpoint — reach the finish for
            your time.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
            {RACE_DIST_PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => applyPreset(m)}
                style={{
                  ...presetBtn,
                  borderColor: targetDist === m ? COLORS.cyanDeep : COLORS.lineD,
                  background: targetDist === m ? 'rgba(41,194,232,0.12)' : COLORS.cream,
                  color: targetDist === m ? COLORS.cyanDeep : COLORS.slate,
                }}
              >
                {formatRaceDistance(m)}
              </button>
            ))}
          </div>

          <label style={labelStyle}>
            Custom distance (m)
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <input
                type="number"
                min={RACE_DIST_MIN}
                max={RACE_DIST_MAX}
                step={100}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onBlur={applyCustom}
                style={inputStyle}
              />
              <Button variant="ghost" onClick={applyCustom}>
                Apply
              </Button>
            </div>
            <span style={{ fontSize: '0.82rem', color: COLORS.slateDim, marginTop: 6, display: 'block' }}>
              {RACE_DIST_MIN.toLocaleString()} – {RACE_DIST_MAX.toLocaleString()} m
            </span>
          </label>

          <div
            style={{
              margin: '22px 0 26px',
              padding: '14px 16px',
              background: 'rgba(32,48,63,0.06)',
              border: `1px solid ${COLORS.lineD}`,
              clipPath: cutPath(10),
            }}
          >
            <div style={{ fontWeight: 700, color: COLORS.slate, marginBottom: 8 }}>
              Your best at {formatRaceDistance(targetDist)} ({control === 'kb' ? 'keyboard' : 'camera'})
            </div>
            {pb ? (
              <div style={{ display: 'flex', gap: 24, fontFamily: FONT_MONO, fontSize: '0.95rem' }}>
                <span>
                  <span style={{ color: COLORS.slateDim }}>Time </span>
                  <strong style={{ color: COLORS.cyanDeep }}>{formatTime(pb.bestTimeMs)}</strong>
                </span>
                <span>
                  <span style={{ color: COLORS.slateDim }}>Rings </span>
                  <strong style={{ color: COLORS.yellowDeep }}>{pb.bestRings}</strong>
                </span>
              </div>
            ) : (
              <span style={{ color: COLORS.slateDim, fontWeight: 500 }}>No finish yet — set the first PB!</span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onBack}>
              ← Back
            </Button>
            <Button variant="primary" onClick={() => onStart(targetDist)}>
              Start race
            </Button>
          </div>
        </Panel>
      </Overlay>
    </div>
  )
}

const presetBtn: React.CSSProperties = {
  padding: '10px 16px',
  fontFamily: FONT_DISPLAY,
  fontWeight: 600,
  fontSize: '1rem',
  border: `1px solid ${COLORS.lineD}`,
  clipPath: cutPath(8),
  cursor: 'pointer',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontWeight: 600,
  color: COLORS.slate,
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '10px 12px',
  fontFamily: FONT_MONO,
  fontSize: '1rem',
  border: `1px solid ${COLORS.lineD}`,
  borderRadius: 8,
  color: COLORS.slate,
}
