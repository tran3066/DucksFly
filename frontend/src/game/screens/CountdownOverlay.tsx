// Big 3 · 2 · 1 · GO over the live scene during the countdown phase.

import { useEffect, useState } from 'react'
import { COLORS, FONT_DISPLAY } from '../ui'

export function CountdownOverlay({ endsAt }: { endsAt: number }) {
  const [secs, setSecs] = useState(() => Math.ceil((endsAt - Date.now()) / 1000))
  useEffect(() => {
    const id = window.setInterval(() => {
      setSecs(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)))
    }, 100)
    return () => window.clearInterval(id)
  }, [endsAt])

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        key={secs}
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: '11rem',
          fontWeight: 700,
          color: secs > 0 ? '#fff' : COLORS.green,
          textShadow: '0 6px 30px rgba(0,0,0,0.6), 0 3px 0 rgba(32,64,96,0.4)',
          animation: 'ducksfly-pop 0.4s ease both',
          letterSpacing: '-0.02em',
        }}
      >
        {secs > 0 ? secs : 'GO!'}
      </div>
    </div>
  )
}
