import { useState } from 'react'
import { SERVER_PRESETS, getServerUrl, setServerUrl } from './serverConfig'

const CUSTOM = '__custom__'

/**
 * Lets the player pick which backend to connect to: a dropdown of presets plus a
 * "Custom…" option with a free-text URL field. Persists the choice via setServerUrl.
 * Render it only before connecting (changing servers mid-session does nothing useful).
 */
export function ServerPicker({ disabled }: { disabled?: boolean }) {
  const initial = getServerUrl()
  const matched = SERVER_PRESETS.find((p) => p.url === initial)
  const [select, setSelect] = useState<string>(matched ? matched.url : CUSTOM)
  const [custom, setCustom] = useState<string>(matched ? '' : initial)

  const onSelect = (value: string) => {
    setSelect(value)
    if (value !== CUSTOM) setServerUrl(value)
    else if (custom.trim()) setServerUrl(custom)
  }

  const onCustom = (value: string) => {
    setCustom(value)
    if (select === CUSTOM && value.trim()) setServerUrl(value)
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', width: '100%' }}>
      <label style={{ opacity: 0.7, fontSize: 12 }}>server</label>
      <select value={select} disabled={disabled} onChange={(e) => onSelect(e.target.value)}>
        {SERVER_PRESETS.map((p) => (
          <option key={p.url} value={p.url}>
            {p.label} — {p.url}
          </option>
        ))}
        <option value={CUSTOM}>Custom…</option>
      </select>
      {select === CUSTOM && (
        <input
          value={custom}
          disabled={disabled}
          onChange={(e) => onCustom(e.target.value)}
          placeholder="wss://your-host.fly.dev"
          style={{ flex: 1, minWidth: 200 }}
        />
      )}
    </div>
  )
}
