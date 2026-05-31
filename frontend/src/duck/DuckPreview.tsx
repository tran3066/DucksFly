import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import { Duck } from './Duck'
import { Bush, Ground, GROUND_VARIANTS, Tree, TREE_VARIANTS } from './NatureProp'
import type { ClipName, DuckVariant } from './loadDuck'

// A few representative clips for eyeballing the animations.
const CLIPS: ClipName[] = [
  'idle_1',
  'walk',
  'take_off',
  'flight_straight',
  'glide_straight',
  'hover_flight',
  'swim_straight',
]

// The duck FBX imports HUGE (~50,000 units tall), so it needs a tiny scale.
// These bracket ~1 to ~5 units tall; pick whichever looks right.
const SCALES = [0.00002, 0.00003, 0.00004, 0.00006, 0.0001] as const

/**
 * Standalone dev harness to confirm the duck renders + animates. Not part of
 * the game — mount it from App during development, delete when integrating.
 */
export function DuckPreview() {
  const [variant, setVariant] = useState<DuckVariant>('male')
  const [clip, setClip] = useState<ClipName>('idle_1')
  const [scale, setScale] = useState<number>(0.00003)

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Canvas shadows camera={{ position: [3, 2, 4], fov: 50 }}>
        <color attach="background" args={['#cfe8ff']} />
        <hemisphereLight args={['#ffffff', '#8d6e4f', 0.9]} />
        <directionalLight
          position={[5, 8, 5]}
          intensity={1.4}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <Duck variant={variant} clip={clip} scale={scale} />
        <Suspense fallback={null}>
          {/* All five tree variants in a row behind the duck. */}
          {TREE_VARIANTS.map((v, i) => (
            <Tree key={v} variant={v} position={[(i - 2) * 4, 0, -5]} />
          ))}
          {/* Three ground tiles laid edge-to-edge (~12 units each) to show tiling. */}
          {GROUND_VARIANTS.map((v, i) => (
            <Ground key={v} variant={v} position={[(i - 1) * 12, 0, 10]} />
          ))}
          <Bush position={[-3, 0, 0]} />
        </Suspense>
        <Grid
          args={[20, 20]}
          cellSize={0.5}
          cellColor="#9bbf9b"
          sectionColor="#6f9f6f"
          infiniteGrid
          fadeDistance={30}
        />
        <OrbitControls makeDefault target={[0, 1, 0]} />
      </Canvas>

      <div style={panel}>
        <strong>Duck preview</strong>

        <Row label="Variant">
          {(['male', 'female'] as DuckVariant[]).map((v) => (
            <button key={v} onClick={() => setVariant(v)} style={btn(v === variant)}>
              {v}
            </button>
          ))}
        </Row>

        <Row label="Scale">
          {SCALES.map((s) => (
            <button key={s} onClick={() => setScale(s)} style={btn(s === scale)}>
              {s}
            </button>
          ))}
        </Row>

        <Row label="Clip">
          <select value={clip} onChange={(e) => setClip(e.target.value as ClipName)} style={select}>
            {CLIPS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Row>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <span style={{ width: 56, opacity: 0.8 }}>{label}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </div>
  )
}

const panel: React.CSSProperties = {
  position: 'fixed',
  top: 12,
  left: 12,
  padding: '12px 14px',
  borderRadius: 10,
  background: 'rgba(20, 28, 40, 0.78)',
  color: '#eef4ff',
  font: '13px/1.3 system-ui, sans-serif',
  backdropFilter: 'blur(6px)',
}

const select: React.CSSProperties = {
  padding: '4px 6px',
  borderRadius: 6,
  border: '1px solid #4a5b74',
  background: '#1b2535',
  color: '#eef4ff',
}

function btn(active: boolean): React.CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid ' + (active ? '#7fb0ff' : '#4a5b74'),
    background: active ? '#2d6cff' : '#1b2535',
    color: '#eef4ff',
    cursor: 'pointer',
  }
}
