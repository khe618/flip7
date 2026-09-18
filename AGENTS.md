# AGENTS.md

Flip 7: real-time multiplayer card game (Express 5 + ws, vanilla JS, no build step) plus an agent harness and benchmark on the same engine.

- Spec: `docs/superpowers/specs/2026-09-17-flip7-design.md`. Agent protocol: `docs/agent-protocol.md`.
- `npm start` runs the server, `npm test` runs `node --test`, `npm run bench -- --agent <spec>` runs the benchmark.
- `lib/engine.js` is the only rules implementation. `lib/view.js` is the only secrecy boundary: `deck`, `rngState`, and `seed` never leave it.
- Every `lib/` factory takes injected `now/setTimeout/clearTimeout/random`; tests never sleep.
- The app shell `public/index.html` is read once at startup; restart the server after editing it.
- Deploy: Render web service `flip7` via `render.yaml`, auto-deploy from `main`; live at https://flip7-q7wz.onrender.com (the bare `flip7` subdomain was taken). Free tier sleeps and forgets rooms.
- Read `LEARNINGS.md` before debugging or editing.
