// The real game entry (route ?view=game). Opens on the start menu, then mounts
// the chosen mode. Single-player and multiplayer are fully separate components
// that only share the gameplay core (FlightScene/FlightRig) — selecting one
// never touches the other's code path.

import { useState } from 'react'
import { StartMenu, type GameMode } from './StartMenu'
import { SinglePlayerGame } from './SinglePlayerGame'
import { MultiplayerGame } from './MultiplayerGame'
import { ModeChooser, type ControlMode } from './ModeChooser'
import { WebcamPanel } from '../debug/WebcamPanel'
import { raceConnection } from '../net/connection'
import { getInitialRoomCode } from '../net/lobbyCode'

export function Game() {
  // A shared `?room=CODE` link skips the menu and drops you straight into multiplayer (the
  // connect screen prefills join mode + the code), so invitees never pick single vs multi.
  const [mode, setMode] = useState<GameMode | null>(() => (getInitialRoomCode() ? 'multi' : null))

  // Camera vs keyboard. Starts 'choose' (no default) on every load/hard refresh; once
  // picked it persists for the whole session (survives menu <-> game). The MediaPipe
  // panel (camera + the one-time calibration) is mounted here at the root ONLY in
  // camera mode, so it stays alive across menu/single/multi without re-calibrating;
  // leaving camera mode unmounts it and stops the camera. SP/MP read `cameraControl`.
  const [controlMode, setControlMode] = useState<ControlMode>('choose')
  const cameraControl = controlMode === 'camera'

  const screen =
    mode === 'single' ? (
      <SinglePlayerGame
        onExit={() => setMode(null)}
        controlMode={controlMode}
        onSetControlMode={setControlMode}
      />
    ) : mode === 'multi' ? (
      <MultiplayerGame
        onExit={() => {
          // Drop the room connection on the way back to the menu.
          raceConnection.leave()
          setMode(null)
        }}
        controlMode={controlMode}
        onSetControlMode={setControlMode}
      />
    ) : (
      <StartMenu onPick={setMode} />
    )

  return (
    <>
      {screen}
      {/* Persistent webcam + calibration pipeline (camera mode only). Mounted at the
          root so it survives menu/single/multi switches and the session baseline is
          never lost on a lobby change. */}
      {cameraControl && <WebcamPanel />}
      {/* Control-mode chooser shown until the player picks (every load / hard refresh). */}
      {controlMode === 'choose' && <ModeChooser onPick={setControlMode} />}
    </>
  )
}
