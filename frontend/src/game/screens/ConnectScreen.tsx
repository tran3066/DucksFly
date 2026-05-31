// Pre-connection screen: shows until we're in a room. Pick a name + duck, then host a new
// lobby or join an existing one by invite code.

import { useMemo, useState, type FormEvent } from 'react'
import type { DuckVariant } from '../../avatar/loadDuck'
import { raceConnection } from '../../net/connection'
import { ServerPicker } from '../../net/ServerPicker'
import type { RaceSnapshot } from '../../net/types'
import { getProfile, saveProfile } from '../../net/profile'
import { getInitialRoomCode, normalizeCode, CODE_LENGTH } from '../../net/lobbyCode'
import { Overlay, Panel, Button, TextInput, COLORS } from '../ui'
import { Field, Segmented, titleStyle, subStyle, linkStyle } from './parts'

export function ConnectScreen({ race, onExit }: { race: RaceSnapshot; onExit?: () => void }) {
  const profile = useMemo(getProfile, [])
  const initialCode = useMemo(getInitialRoomCode, [])
  const [name, setName] = useState(profile.name)
  const [variant, setVariant] = useState<DuckVariant>(profile.variant)
  const [mode, setMode] = useState<'host' | 'join'>(initialCode ? 'join' : 'host')
  const [code, setCode] = useState(initialCode)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const connecting = race.status === 'connecting'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const finalName = name.trim() || profile.name
    saveProfile({ name: finalName, variant })
    if (mode === 'host') {
      void raceConnection.host({ name: finalName, duckVariant: variant })
    } else {
      const c = normalizeCode(code)
      if (c.length < CODE_LENGTH) return
      void raceConnection.joinByCode(c, { name: finalName, duckVariant: variant })
    }
  }

  return (
    <Overlay>
      <Panel width={440}>
        <h1 style={titleStyle}>
          <span style={{ fontSize: '1.6rem' }}>🦆</span> Multiplayer
        </h1>
        <p style={subStyle}>Race other ducks live through the same sky.</p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Your name">
            <TextInput value={name} onChange={setName} placeholder="name" maxLength={16} />
          </Field>

          <Field label="Duck">
            <Segmented
              options={[
                { id: 'male', label: 'Male' },
                { id: 'female', label: 'Female' },
              ]}
              value={variant}
              onChange={(v) => setVariant(v as DuckVariant)}
            />
          </Field>

          <Segmented
            options={[
              { id: 'host', label: 'Host a lobby' },
              { id: 'join', label: 'Join a lobby' },
            ]}
            value={mode}
            onChange={(v) => setMode(v as 'host' | 'join')}
          />

          {mode === 'join' && (
            <Field label="Invite code">
              <TextInput
                value={code}
                onChange={(v) => setCode(normalizeCode(v))}
                placeholder="ABCD"
                uppercase
                maxLength={CODE_LENGTH}
              />
            </Field>
          )}

          <Button
            type="submit"
            variant="primary"
            accent={mode === 'host' ? COLORS.accentBlue : COLORS.accent}
            disabled={connecting || (mode === 'join' && normalizeCode(code).length < CODE_LENGTH)}
            style={{ marginTop: 4 }}
          >
            {connecting ? 'Connecting…' : mode === 'host' ? 'Create lobby' : 'Join lobby'}
          </Button>

          {race.status === 'error' && race.error && (
            <div style={{ color: COLORS.bad, fontSize: '0.85rem' }}>{race.error}</div>
          )}
        </form>

        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          {onExit && (
            <Button variant="ghost" onClick={onExit} style={{ padding: '8px 14px' }}>
              ← Menu
            </Button>
          )}
          <button type="button" onClick={() => setShowAdvanced((s) => !s)} style={linkStyle}>
            {showAdvanced ? 'Hide server' : 'Server settings'}
          </button>
        </div>

        {showAdvanced && (
          <div style={{ marginTop: 12 }}>
            <ServerPicker disabled={connecting} />
          </div>
        )}
      </Panel>
    </Overlay>
  )
}
