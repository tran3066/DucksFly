// Control-mode chooser + in-game toggle.
//
// The shipped game opens on this chooser (no default): the player picks camera
// (MediaPipe body control) or keyboard. The choice lives in <Game> for the
// session — it survives menu -> lobby -> game and is reset only by a hard refresh.
// Picking camera is the user gesture that later lets the webcam panel start the
// camera and run the one-time calibration.

import {
  BrandMark,
  Button,
  COLORS,
  FONT_DISPLAY,
  FONT_MONO,
  Overlay,
  Panel,
  UI_KEYFRAMES,
  cutPath,
} from './ui'

// 'choose' = no pick yet (show the chooser). The two real modes drive whether the
// webcam pipeline is mounted and whether FlightRig folds in gestures.
export type ControlMode = 'choose' | 'keyboard' | 'camera'

export function ModeChooser({ onPick }: { onPick: (mode: ControlMode) => void }) {
  return (
    <Overlay>
      <style>{UI_KEYFRAMES}</style>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 26,
          maxWidth: 560,
          width: '100%',
        }}
      >
        <div style={{ animation: 'ducksfly-rise 0.5s both' }}>
          <BrandMark />
          <div
            style={{
              marginTop: 10,
              textAlign: 'center',
              fontFamily: FONT_DISPLAY,
              fontWeight: 500,
              fontSize: '1.15rem',
              color: '#fff',
              textShadow: '0 2px 8px rgba(20,40,60,0.4)',
            }}
          >
            Flap. Bank. Dive. Race through the rings.
          </div>
        </div>

        <Panel width={560} style={{ textAlign: 'center', animation: 'ducksfly-rise 0.5s 0.14s both' }}>
          <h2
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: '1.85rem',
              margin: '0 0 12px',
              color: COLORS.slate,
            }}
          >
            How do you want to fly?
          </h2>
          <p
            style={{
              color: COLORS.slateDim,
              fontWeight: 500,
              lineHeight: 1.55,
              margin: '0 0 24px',
              fontSize: '1rem',
            }}
          >
            Use your <strong style={{ color: COLORS.slate }}>camera</strong> to flap your arms like
            wings, or play with the <strong style={{ color: COLORS.slate }}>keyboard</strong>. You
            can switch anytime — camera mode calibrates once.
          </p>
          <div
            style={{
              display: 'flex',
              gap: 14,
              justifyContent: 'center',
              flexWrap: 'wrap',
              marginBottom: 20,
            }}
          >
            <Button variant="cyan" onClick={() => onPick('camera')}>
              🎥 Use camera
            </Button>
            <Button variant="ghost" onClick={() => onPick('keyboard')}>
              ⌨️ Use keyboard
            </Button>
          </div>
          <p
            style={{
              fontSize: '0.82rem',
              color: COLORS.slateDim,
              fontWeight: 500,
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            Camera control needs webcam access and works best with your upper body in view.
          </p>
        </Panel>
      </div>
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
        padding: '8px 14px',
        background: COLORS.hud,
        border: `1px solid ${COLORS.cyan}55`,
        color: COLORS.hudText,
        fontFamily: FONT_MONO,
        fontSize: '0.78rem',
        fontWeight: 500,
        cursor: 'pointer',
        backdropFilter: 'blur(7px)',
        WebkitBackdropFilter: 'blur(7px)',
        clipPath: cutPath(8),
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          background: COLORS.cyan,
          borderRadius: '50%',
          boxShadow: `0 0 8px ${COLORS.cyan}`,
          display: 'inline-block',
        }}
      />
      {label}
    </button>
  )
}
