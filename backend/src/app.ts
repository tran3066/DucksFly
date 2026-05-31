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
  // filterBy(["code"]) groups rooms by their invite code: the host creates a room with a
  // client-generated code, and `client.join("race", { code })` matches that exact room
  // (or throws "not found" if there isn't one). This is the built-in private-lobby pattern.
  gameServer.define("race", RaceRoom).filterBy(["code"]);
  return gameServer;
}
