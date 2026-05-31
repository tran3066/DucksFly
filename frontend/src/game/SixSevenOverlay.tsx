// The on-screen "6 7" easter-egg pop. When the two-handed alternation gesture is
// recognized, a big "6 7" slowly scales/fades in with a glow, holds, then fades
// out. Purely cosmetic and pointer-events:none so it never blocks the game.
//
// Driven by a `trigger` counter that the game bumps on each detection: changing it
// re-keys the animated node so the CSS animation replays from the start. The 6-7
// sound is gated so triggers do not overlap, so the pops do not stack either.

// One full play of the pop: slow scale+fade in with a glow, a brief hold, then a
// scale-up fade-out. Ends fully transparent (fill-mode forwards on the node).
const SIX_SEVEN_KEYFRAMES = `
@keyframes sixSevenPop {
  0%   { opacity: 0; transform: scale(0.35) rotate(-10deg); filter: blur(10px); }
  22%  { opacity: 1; transform: scale(1.15) rotate(3deg);  filter: blur(0); }
  40%  { transform: scale(1.0) rotate(0deg); }
  68%  { opacity: 1; transform: scale(1.05); }
  100% { opacity: 0; transform: scale(1.45); filter: blur(6px); }
}`

const containerStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  zIndex: 60,
}

const textStyle: React.CSSProperties = {
  // Big and responsive; ease-out so the entrance feels slow then settles.
  fontSize: 'clamp(120px, 30vw, 380px)',
  fontWeight: 900,
  letterSpacing: '0.06em',
  color: '#ffd24a',
  // Layered glow so it reads as a flashy pop, not flat text.
  textShadow:
    '0 0 18px rgba(255,210,74,0.9), 0 0 48px rgba(255,150,30,0.7), 0 6px 24px rgba(0,0,0,0.5)',
  fontFamily: 'system-ui, ui-rounded, "Segoe UI", sans-serif',
  animation: 'sixSevenPop 2.2s cubic-bezier(0.18, 0.9, 0.3, 1) forwards',
  userSelect: 'none',
}

/**
 * Renders the "6 7" pop. `trigger` is a counter the game increments on each
 * detection; a new value replays the animation (via the React key). At 0 nothing
 * shows. The keyframes live in an always-mounted <style> so re-keying only the
 * text node is enough to restart the animation.
 */
export function SixSevenOverlay({ trigger }: { trigger: number }): React.JSX.Element {
  return (
    <>
      <style>{SIX_SEVEN_KEYFRAMES}</style>
      {trigger > 0 && (
        <div style={containerStyle} aria-hidden="true">
          <span key={trigger} style={textStyle}>
            6 7
          </span>
        </div>
      )}
    </>
  )
}
