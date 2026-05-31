# Backend Deploy Plan — DucksFly (Colyseus on Fly.io)

## Constraints
- Stateful WebSocket server (Colyseus) → no serverless.
- Players in Oregon → US-West region (`sea`, Seattle, ~15-20ms).
- Peak ~30 concurrent players → one small always-on machine, single process, no Redis.
- Goal: cheap + low lag.

## Decision: Fly.io, `sea`, 1× shared-cpu-1x / 256MB, always-on (~free–$2/mo).

---

## ⚠️ Build gotchas found (these would break a first-time deploy)

1. **Shared code lives OUTSIDE `backend/`.**
   `backend/src/**` imports `@shared/*`, which `backend/tsconfig.json` maps to
   `../types/*` (repo-root `types/` folder: `network.ts`, `constants.ts`,
   `messages.ts`, `duckActions.ts`, `index.ts`).
   These are **real value imports** (`MAX_PLAYERS`, `COUNTDOWN_MS`, `ClientMessage`,
   `ServerMessage`, …), not just type-only imports → required at build time.
   → **Docker build context must be the repo root**, copying BOTH `backend/` and `types/`.
   A Dockerfile rooted in `backend/` alone will fail (`Cannot find module @shared/...`).

2. **`tsup` bundles via esbuild and reads `tsconfig.json` `paths`**, so `@shared/*`
   resolves to `../types/*` at build time and the result is bundled into a
   self-contained `build/index.js`. This works only if `../types` exists in the
   build context (see #1).

3. **ESM runtime requirement.** Build output is ESM (`--format esm`) and
   `package.json` has `"type": "module"`. If the runtime image contains
   `build/index.js` WITHOUT a `package.json` that has `"type":"module"`, Node treats
   `.js` as CommonJS and crashes on `import`. → Keep `package.json` in the runtime image.

4. **`npm ci` is standalone-safe.** `backend/` has its own `package-lock.json`, so
   `npm ci` inside `backend/` works without the (orphaned) root `package-lock.json`.
   Do NOT rely on the root lockfile (there is no root `package.json`).

5. **Binding is fine.** `app.ts` uses `WebSocketTransport()` with `.listen(PORT)`,
   which binds `0.0.0.0` by default — no container binding change needed.

6. **Verify before deploy:** run `cd backend && npm run build` once locally and
   confirm `build/index.js` is produced and `node build/index.js` starts. (Not yet
   run — do this as step 0.)

---

## Files to add (at REPO ROOT, because of gotcha #1)

### `Dockerfile` (repo root)
```dockerfile
# Build context = repo root so we can copy both backend/ and types/
FROM node:20-slim AS build
WORKDIR /app
# deps first (cache-friendly)
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci
# source: backend + the shared types it imports via @shared -> ../types
COPY backend/ ./backend/
COPY types/ ./types/
RUN cd backend && npm run build      # esbuild bundles @shared into build/index.js

FROM node:20-slim AS runtime
WORKDIR /app/backend
ENV NODE_ENV=production
# keep package.json so Node honors "type":"module" for the ESM bundle (gotcha #3)
COPY --from=build /app/backend/package.json ./package.json
COPY --from=build /app/backend/build ./build
EXPOSE 8080
ENV PORT=8080
CMD ["node", "build/index.js"]
```
- Runtime stage ships only the bundled `build/` + `package.json` → tiny image, no
  node_modules needed (everything is bundled by tsup/esbuild).

### `.dockerignore` (repo root)
```
**/node_modules
**/build
frontend
.git
*.md
.env*
```
(`frontend` excluded — backend build doesn't need it.)

### `fly.toml` (repo root)
```toml
app = "ducksfly"           # set on `fly launch`
primary_region = "sea"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false   # always-on: no cold-start lag mid-session
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
```
Note: Colyseus over Fly's `http_service` works because Fly upgrades the same port to
WebSocket; no separate `[[services]]` ports block needed.

---

## Steps (in order)
0. **Verify build locally:** `cd backend && npm run build && node build/index.js`
   → expect `DucksFly server listening on ws://localhost:2567`. Ctrl-C.
1. Add the three files above at the **repo root**.
2. `fly launch --no-deploy` at repo root → app name, region `sea`, **no** Postgres/Redis.
   (Let it detect the Dockerfile; don't accept any generated Node buildpack.)
3. `fly deploy`.
4. Confirm: `fly logs` shows the listening line; `wss://ducksfly.fly.dev` reachable.
5. Frontend: set `VITE_SERVER_URL=wss://ducksfly.fly.dev` in `frontend/.env.local`,
   rebuild/redeploy frontend.

## Health check (optional, nice-to-have)
Colyseus/express responds on `/` — can add a Fly `[[http_service.checks]]` GET `/`
later. Not required for first deploy.

## Alternatives (rejected)
- Render free: only US-West = Oregon, but free tier sleeps → cold-start lag.
- Railway: works, ~$5/mo credit, US-West region less clearly near Oregon.
- VPS (Hetzner/DO): cheapest raw, but manual TLS + ops overhead.

## Cost
~free–$2/mo (one 256MB shared machine, always-on, minimal egress at 30 players).
