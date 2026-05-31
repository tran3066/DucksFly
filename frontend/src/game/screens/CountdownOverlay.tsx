// Big 3 · 2 · 1 · GO over the live scene during the countdown phase.

import { useEffect, useState } from 'react'
import { COLORS, FONT } from '../ui'

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
          fontFamily: FONT,
          fontSize: '9rem',
          fontWeight: 800,
          color: secs > 0 ? COLORS.text : COLORS.good,
          textShadow: '0 6px 30px rgba(0,0,0,0.6)',
          animation: 'ducksfly-pop 0.4s ease both',
        }}
      >
        {secs > 0 ? secs : 'GO!'}
      </div>
    </div>
  )
}
