import { useEffect, useState, type FormEvent } from "react";
import type { DuckVariant } from "@shared/network";
import { raceConnection } from "../net/connection";
import { getServerUrl } from "../net/serverConfig";
import { useRace, isHost } from "../net/useRace";
import "./test.css";

/**
 * Bare-bones multiplayer test harness — NOT the game UI. Reachable two ways:
 *   - as a view in the main app:  /?view=multiplayer
 *   - as the standalone page:     /test.html
 * Open it in several browser tabs/windows to act as several players: join,
 * ready up, host starts, then use the dev buttons to push positions / ring
 * passes at the server and watch the synced state update live in every tab.
 * Lets us verify the server end-to-end before the real frontend exists.
 */

/** Mirrors the backend MIN_PLAYERS_TO_START (src/logic/stateMachine.ts). */
const MIN_PLAYERS_TO_START = 2;

const randomName = () => `Duck-${Math.floor(1000 + Math.random() * 9000)}`;

export function MultiplayerTest() {
  const race = useRace();
  const [name, setName] = useState(randomName);
  const [variant, setVariant] = useState<DuckVariant>("male");
  const [auto, setAuto] = useState(false);

  const self = race.players.find((p) => p.id === race.sessionId);
  const connected = race.status === "connected";
  const racing = race.phase === "racing";
  const canStart =
    isHost(race) && race.phase === "lobby" && race.players.length >= MIN_PLAYERS_TO_START;
  const nextRing = self && race.ringCount > 0 ? self.ringsPassed % race.ringCount : 0;

  // Auto-move: stream random positions while racing so sync is visible across tabs.
  useEffect(() => {
    if (!auto || !racing) return;
    const id = window.setInterval(() => {
      raceConnection.sendState({
        pos: [(Math.random() - 0.5) * 20, 10 + (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 20],
        vel: [0, 0, 0],
        quat: [0, 0, 0, 1],
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [auto, racing]);

  const join = (e: FormEvent) => {
    e.preventDefault();
    void raceConnection.join({ name: name.trim() || randomName(), duckVariant: variant });
  };

  return (
    <div className="harness">
      <header className="bar">
        <h1>🦆 DucksFly · multiplayer test harness</h1>
        <div className="meta">
          <span>server <code>{getServerUrl()}</code></span>
          <span>status <b className={`st-${race.status}`}>{race.status}</b></span>
          <span>phase <b>{race.phase}</b></span>
          {race.sessionId && (
            <span>
              you <code>{race.sessionId.slice(0, 6)}</code>
              {isHost(race) ? " (host)" : ""}
            </span>
          )}
        </div>
      </header>

      {!connected ? (
        <form className="join" onSubmit={join}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name" />
          <select value={variant} onChange={(e) => setVariant(e.target.value as DuckVariant)}>
            <option value="male">male</option>
            <option value="female">female</option>
          </select>
          <button type="submit" disabled={race.status === "connecting"}>
            {race.status === "connecting" ? "connecting…" : "Join"}
          </button>
          {race.status === "error" && <span className="err">{race.error}</span>}
          <p className="tip">Open this page in several tabs to simulate multiple players.</p>
        </form>
      ) : (
        <>
          <div className="actions">
            <button onClick={() => raceConnection.setReady(!self?.ready)}>
              {self?.ready ? "Unready" : "Ready"}
            </button>
            <button disabled={!canStart} onClick={() => raceConnection.startRace()}>
              Start race
            </button>
            <button
              disabled={!racing}
              title="Send your duck to the origin; two ducks at the origin collide & spin out"
              onClick={() =>
                raceConnection.sendState({ pos: [0, 0, 0], vel: [0, 0, 0], quat: [0, 0, 0, 1] })
              }
            >
              Move to center (collide)
            </button>
            <button
              disabled={!racing}
              onClick={() => raceConnection.ringPassed(nextRing, self?.lap ?? 0)}
            >
              Pass ring {nextRing}
            </button>
            <label className="auto">
              <input
                type="checkbox"
                checked={auto}
                disabled={!racing}
                onChange={(e) => setAuto(e.target.checked)}
              />
              auto-move
            </label>
            <button
              className="leave"
              onClick={() => {
                setAuto(false);
                raceConnection.leave();
              }}
            >
              Leave
            </button>
          </div>

          <table className="players">
            <thead>
              <tr>
                <th>#</th>
                <th>name</th>
                <th>duck</th>
                <th>ready</th>
                <th>rings</th>
                <th>lap</th>
                <th>fin</th>
                <th>spun</th>
                <th>pos (x, y, z)</th>
              </tr>
            </thead>
            <tbody>
              {race.players.map((p) => (
                <tr key={p.id} className={p.id === race.sessionId ? "me" : ""}>
                  <td>{p.rank || ""}</td>
                  <td>
                    {p.name}
                    {p.id === race.sessionId ? " (you)" : ""}
                  </td>
                  <td>{p.duckVariant}</td>
                  <td>{p.ready ? "✓" : ""}</td>
                  <td>{p.ringsPassed}</td>
                  <td>{p.lap}</td>
                  <td>{p.finished ? "🏁" : ""}</td>
                  <td>{p.spunOut ? "💫" : ""}</td>
                  <td className="pos">
                    {p.pos.x.toFixed(1)}, {p.pos.y.toFixed(1)}, {p.pos.z.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="tip">
            {race.players.length} player(s) · need {MIN_PLAYERS_TO_START}+ to start · map seed{" "}
            {race.mapSeed} · {race.ringCount} rings/lap
          </p>
        </>
      )}
    </div>
  );
}
