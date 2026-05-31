# Demo / Backup Server Plan

## Problem
Hackathon: public traffic could spam/overload the single backend. Need a reliable, isolated server for live demos that *our* machines always use.

## Current state
- Frontend server resolution (`frontend/src/net/serverConfig.ts`): `?server=` → localStorage → `VITE_SERVER_URL` → `FALLBACK_URL` (`wss://ducksfly.fly.dev`).
- `SERVER_PRESETS` dropdown via `ServerPicker.tsx`.
- Backend on Fly (`fly.toml`), deploy with `fly deploy`. Frontend on Vercel.

## Approach (CHOSEN)
- Backup URL stays OUT of `SERVER_PRESETS` — reachable only via `?server=` special URL. No frontend code changes.
- Deploy backup on Fly, bookmark the param URL on demo machines.

### Backup backend deploy (easiest, reuse Fly)
- `fly apps create ducksfly-demo`
- `fly deploy -a ducksfly-demo`  (same Dockerfile/fly.toml)
- URL: `wss://ducksfly-demo.fly.dev`

### Make our machines always use it
- Visit site once with `?server=wss://ducksfly-demo.fly.dev` → persisted to localStorage → sticks.
- (optional) add as `SERVER_PRESETS` entry for one-click.

## Open questions
- Keep demo URL out of shipped code (obscurity) vs. fine in dropdown?

## Options for "stickiness" (alternatives)
- localStorage via `?server=` (zero code) — chosen lean.
- Separate Vercel preview/branch deploy with `VITE_SERVER_URL=wss://ducksfly-demo.fly.dev`.
- Hostname/env detection in serverConfig (e.g. localhost → demo).
