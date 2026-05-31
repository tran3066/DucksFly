// Control-mode chooser + in-game toggle.
//
// The shipped game opens on this chooser (no default): the player picks camera
// (MediaPipe body control) or keyboard. The choice lives in <Game> for the
// session — it survives menu -> lobby -> game and is reset only by a hard refresh.
// Picking camera is the user gesture that later lets the webcam panel start the
// camera and run the one-time calibration.

import { Overlay, Panel, Button, COLORS, FONT, UI_KEYFRAMES } from './ui'

// 'choose' = no pick yet (show the chooser). The two real modes drive whether the
// webcam pipeline is mounted and whether FlightRig folds in gestures.
export type ControlMode = 'choose' | 'keyboard' | 'camera'

export function ModeChooser({ onPick }: { onPick: (mode: ControlMode) => void }) {
  return (
    <Overlay>
      <style>{UI_KEYFRAMES}</style>
      <Panel width={460} style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '1.7rem', fontWeight: 800, color: COLORS.text, marginBottom: 6 }}>
          How do you want to fly?
        </div>
        <p style={{ color: COLORS.dim, margin: '0 0 22px', fontSize: '0.92rem', lineHeight: 1.5 }}>
          Use your <strong>camera</strong> to flap your arms like wings, or play with the{' '}
          <strong>keyboard</strong>. You can switch anytime — camera mode calibrates once.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button
            variant="primary"
            accent={COLORS.accentBlue}
            onClick={() => onPick('camera')}
            style={{ minWidth: 150 }}
          >
            🎥 Use camera
          </Button>
          <Button variant="ghost" onClick={() => onPick('keyboard')} style={{ minWidth: 150 }}>
            ⌨️ Use keyboard
          </Button>
        </div>
        <p style={{ color: COLORS.faint, margin: '18px 0 0', fontSize: '0.78rem' }}>
          Camera control needs webcam access and works best with your upper body in view.
        </p>
      </Panel>
    </Overlay>
  )
}

/**
 * Small fixed-corner control to flip camera <-> keyboard during play. Switching to
 * camera with an existing session baseline skips calibration; the first switch to
 * camera (no baseline yet) opens the one-time calibration gate. Render `null` to
 * hide it (e.g. during a live multiplayer race).
 */
export function ControlModeToggle({
  mode,
  onChange,
  style,
}: {
  mode: 'keyboard' | 'camera'
  onChange: (mode: ControlMode) => void
  style?: React.CSSProperties
}) {
  const next = mode === 'camera' ? 'keyboard' : 'camera'
  const label = mode === 'camera' ? '🎥 Camera' : '⌨️ Keyboard'
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      title={`Switch to ${next} control`}
      style={{
        position: 'absolute',
        padding: '6px 12px',
        borderRadius: 8,
        border: '1px solid rgba(120,150,180,0.3)',
        background: 'rgba(14,21,34,0.82)',
        color: COLORS.text,
        fontFamily: FONT,
        fontSize: '0.8rem',
        fontWeight: 600,
        cursor: 'pointer',
        backdropFilter: 'blur(6px)',
        ...style,
      }}
    >
      {label}
    </button>
  )
}
