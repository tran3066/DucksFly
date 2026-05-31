// Brief red full-screen flash when the local duck crashes (tree trunk or ring rim)
// and snaps back to the last checkpoint. Purely cosmetic — the actual respawn
// happens in FlightRig. `at` is the crash timestamp (performance.now()); changing
// it re-keys the element so each crash restarts the fade.

export function CrashFlash({ at }: { at: number }) {
  if (!at) return null
  return (
    <>
      <style>{'@keyframes ducksflyCrashFlash{from{opacity:.5}to{opacity:0}}'}</style>
      <div
        key={at}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: '#ff2b2b',
          opacity: 0,
          animation: 'ducksflyCrashFlash 0.35s ease-out forwards',
        }}
      />
    </>
  )
}
