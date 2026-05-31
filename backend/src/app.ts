import { createServer } from "node:http";
import express from "express";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { RaceRoom } from "./rooms/RaceRoom";

/**
 * Build (but do not start) the Colyseus server with the "race" room registered. Returning an
 * un-listened Server keeps this reusable: src/index.ts calls `.listen(port)` for production,
 * and @colyseus/testing's `boot()` calls `.listen()` itself for the integration tests.
 *
 * The WebSocket transport shares an Express HTTP server so the host can also answer plain
 * HTTP requests — notably GET /health, which Railway (and any uptime check) pings to confirm
 * the service is live.
 */
export function createGameServer(): Server {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/", (_req, res) => {
    res.type("text/plain").send("DucksFly server is up. Connect a Colyseus client to this host.");
  });

  const httpServer = createServer(app);
  const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
  gameServer.define("race", RaceRoom);
  return gameServer;
}
