import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { RaceRoom } from "./rooms/RaceRoom";

/**
 * Build (but do not start) the Colyseus server with the "race" room registered. Returning an
 * un-listened Server keeps this reusable: src/index.ts calls `.listen(port)` for production,
 * and @colyseus/testing's `boot()` calls `.listen()` itself for the integration tests.
 */
export function createGameServer(): Server {
  const gameServer = new Server({ transport: new WebSocketTransport() });
  gameServer.define("race", RaceRoom);
  return gameServer;
}
