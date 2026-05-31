# How to run DucksFly

Two pieces talk to each other:

- **backend/** — the Colyseus game server (one shared server everyone joins).
- **frontend/** — the React app each player opens in their browser.

You need **Node 20+** installed. Check with `node -v`.

---

## 1. Start the server (backend)

```bash
cd backend
npm install        # first time only
npm run dev        # starts on ws://localhost:2567, restarts on file changes
```

You should see: `DucksFly server listening on port 2567 (health: /health)`.

Other backend commands:

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the server with auto-reload (development). |
| `npm start` | Run the built server (after `npm run build`). |
| `npm run build` | Bundle the server into `build/`. |
| `npm test` | Run all unit + room tests once. |
| `npm run test:watch` | Re-run tests as you edit. |
| `npm run typecheck` | Type-check without building. |

The server port can be changed with an env var: `PORT=3000 npm run dev`.

---

## 2. Start the app (frontend)

In a **second terminal**:

```bash
cd frontend
npm install        # first time only
npm run dev        # serves on http://localhost:5173
```

The real game UI is still being built. To **test the multiplayer server right now**,
open the test harness instead of the home page:

```
http://localhost:5173/test.html
```

Open that URL in **two or more browser tabs/windows** — each tab is a separate player.
In each tab: type a name, hit **Join**, then **Ready**. The first player to join is the
host and can press **Start race** once 2+ ducks are in. After the countdown you can:

- **Move to center (collide)** — send your duck to the origin; do it in two tabs and
  watch both spin out (💫).
- **Pass ring N** — report passing the next ring; watch `rings`, `lap`, and the `#`
  rank update across every tab.
- **auto-move** — stream random positions so you can see live position sync.

Every tab shows the same shared player table, which is how you confirm the server is
relaying state to everyone.

---

## 3. Letting other people join

Multiplayer only works if everyone connects to **the same server**. One person runs
the backend; everyone points their frontend at that server's address.

The frontend reads the server address from `VITE_SERVER_URL`. Copy the example file
and edit it:

```bash
cd frontend
cp .env.example .env.local
# then set VITE_SERVER_URL in .env.local
```

Pick the option that matches your situation:

| Situation | `VITE_SERVER_URL` | Notes |
| --- | --- | --- |
| Just you, testing | `ws://localhost:2567` | The default — no `.env.local` needed. |
| Same Wi-Fi (e.g. hackathon table) | `ws://<host-ip>:2567` | Find the host's IP with `ipconfig getifaddr en0` (macOS) or `hostname -I` (Linux). |
| Anyone, no deploy | `wss://<tunnel-host>` | Run a tunnel (e.g. `ngrok http 2567`) and use the `wss://` URL it prints. |
| Deployed server | `wss://your-host.example.com` | When you host the backend somewhere permanent. |

After changing `.env.local`, restart `npm run dev` in the frontend so it picks up the
new value.

> Note: `localhost` means *your own machine*. Teammates can't reach your `localhost` —
> use the LAN IP or a tunnel for them to join.

---

## 4. Deploy the server publicly (Railway)

For an always-on server everyone (and the demo) can reach, deploy the backend to
[Railway](https://railway.com). The repo is already set up for it:

- `backend/railway.json` — tells Railway to build with Nixpacks, run `npm run start`,
  and healthcheck `GET /health`.
- The server reads the `PORT` env var (Railway sets this automatically) and exposes
  `/health`, which returns `{"ok":true}`.

**One-time setup (in the Railway dashboard):**

1. **New Project → Deploy from GitHub repo**, pick this repo.
2. In the service **Settings → Build**, set **Root Directory** to `backend`.
   (The repo is a monorepo; this points Railway at the server. The shared `types/`
   folder at the repo root stays available during the build.)
3. Railway auto-detects Node + the `railway.json`. Build command and start command
   come from there; no extra config needed.
4. **Settings → Networking → Generate Domain.** You'll get a URL like
   `ducksfly-production.up.railway.app`.
5. Deploy. When it's healthy, open `https://<your-domain>/health` in a browser — you
   should see `{"ok":true}`.

**Point the frontend at it.** The Railway domain is HTTPS, so the WebSocket URL is
`wss://` (not `ws://`) and has **no port**:

```bash
# frontend/.env.local
VITE_SERVER_URL=wss://ducksfly-production.up.railway.app
```

Restart the frontend dev server (or rebuild) after changing this. Now anyone running
the frontend — anywhere — connects to the same hosted room.

> Prefer the CLI? `npm i -g @railway/cli`, then from `backend/`: `railway login`,
> `railway init`, `railway up`. Set the service Root Directory to `backend` either way.

---

## Quick start (TL;DR)

```bash
# terminal 1
cd backend && npm install && npm run dev

# terminal 2
cd frontend && npm install && npm run dev
# open http://localhost:5173
```
