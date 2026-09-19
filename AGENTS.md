# AGENTS.md

Flip 7 Arena: real-time multiplayer card game (Express 5 + ws, vanilla JS, no build step) plus an agent harness and benchmark on the same engine.

- Spec: `docs/superpowers/specs/2026-09-17-flip7-design.md`. Agent protocol: `docs/agent-protocol.md`.
- `npm start` runs the server, `npm test` runs `node --test`, `npm run bench -- --agent <spec>` runs the benchmark.
- `lib/engine.js` is the only rules implementation. `lib/view.js` is the only secrecy boundary: `deck`, `rngState`, and `seed` never leave it.
- Every `lib/` factory takes injected `now/setTimeout/clearTimeout/random`; tests never sleep.
- The app shell `public/index.html` is read once at startup; restart the server after editing it.
- Deploy: Render web service `flip7-arena` via `render.yaml`, auto-deploy from `main`; live at https://flip7-arena.onrender.com (renamed from `flip7`/flip7-q7wz on 2026-09-19). Free tier sleeps and forgets rooms.
- The browser client animates engine events from `game.history` via `public/js/sequence.js` (pure, tested) and `present.js`; `table.js` reconciles to the snapshot at each barrier. Keep `sequence.js`/`present.js` DOM-free.
- Read `LEARNINGS.md` before debugging or editing.
