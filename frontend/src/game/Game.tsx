// The real game entry (route ?view=game). Opens on the start menu, then mounts
// the chosen mode. Single-player splits into Race (finite, configurable distance)
// and Infinite Run; multiplayer is unchanged. All modes share FlightScene/FlightRig.

import { useState } from 'react'
import { StartMenu, type GameMode } from './StartMenu'
import { RaceSetup } from './RaceSetup'
import { SinglePlayerGame } from './SinglePlayerGame'
import { InfiniteRunGame } from './InfiniteRunGame'
import { MultiplayerGame } from './MultiplayerGame'
import { ModeChooser, type ControlMode } from './ModeChooser'
import { WebcamPanel } from '../debug/WebcamPanel'
import { raceConnection } from '../net/connection'
import { getInitialRoomCode } from '../net/lobbyCode'
import { RACE_DIST_DEFAULT } from './raceDistance'

export function Game() {
  // A shared `?room=CODE` link skips the menu and drops you straight into multiplayer (the
  // connect screen prefills join mode + the code), so invitees never pick single vs multi.
  const [mode, setMode] = useState<GameMode | null>(() => (getInitialRoomCode() ? 'multi' : null))
  const [raceTargetDist, setRaceTargetDist] = useState(RACE_DIST_DEFAULT)

  // Camera vs keyboard. Starts 'choose' (no default) on every load/hard refresh; once
  // picked it persists for the whole session (survives menu <-> game). The MediaPipe
  // panel (camera + the one-time calibration) is mounted here at the root ONLY in
  // camera mode, so it stays alive across menu/single/multi without re-calibrating;
  // leaving camera mode unmounts it and stops the camera. SP/MP read `cameraControl`.
  const [controlMode, setControlMode] = useState<ControlMode>('choose')
  const cameraControl = controlMode === 'camera'

  const backToMenu = () => setMode(null)

  const screen =
    mode === 'race' ? (
      <SinglePlayerGame
        targetDist={raceTargetDist}
        onExit={backToMenu}
        controlMode={controlMode}
        onSetControlMode={setControlMode}
      />
    ) : mode === 'infinite' ? (
      <InfiniteRunGame
        onExit={backToMenu}
        controlMode={controlMode}
        onSetControlMode={setControlMode}
      />
    ) : mode === 'multi' ? (
      <MultiplayerGame
        onExit={() => {
          raceConnection.leave()
          backToMenu()
        }}
        controlMode={controlMode}
        onSetControlMode={setControlMode}
      />
    ) : mode === 'race-setup' ? (
      <RaceSetup
        controlMode={controlMode}
        onStart={(dist) => {
          setRaceTargetDist(dist)
          setMode('race')
        }}
        onBack={backToMenu}
      />
    ) : (
      <StartMenu onPick={setMode} />
    )

  return (
    <>
      {screen}
      {cameraControl && <WebcamPanel />}
      {controlMode === 'choose' && <ModeChooser onPick={setControlMode} />}
    </>
  )
}
