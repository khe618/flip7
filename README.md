# Flip 7 Arena

Live: https://flip7-arena.onrender.com (Render free tier; first request after idle takes about a minute).

Flip 7 Arena is a real-time multiplayer Flip 7 (press-your-luck card game) website — Express 5 plus raw WebSockets, vanilla JS in the browser, no build step — built on a single rules engine that also runs headless as an agent benchmark: any program that can read a JSON observation and answer with a JSON action can play through one of three adapters (in-process, subprocess, HTTP), or take a seat in a live room.

## Run it

```
npm start
```

Serves the app at `http://localhost:3000`. Create a room from the landing page, or quick-play against bots. Bots think for 1.8 to 2.6 s so reveals are readable (`BOT_DELAY_MIN_MS` / `BOT_DELAY_MAX_MS`).

## Test

```
npm test
```

Runs the whole suite under `node --test`.

## Benchmark quick start

Play an agent against the baseline bots over a seeded suite:

```
node bench/run.js --agent file:./agents/examples/threshold.js --suite smoke
```

Other adapters:

```
node agents/examples/http-server.js 8080
node bench/run.js --agent http://localhost:8080 --suite smoke

node bench/run.js --agent "cmd:python agents/examples/subprocess.py" --suite smoke
```

Each run writes `bench/results/<runId>/games.jsonl` and `summary.json`, plus `run-private.json` — the seeds, which are deliberately kept out of the log an agent can read (see the trust boundary in the protocol doc). Rate multiple agents against each other with `node bench/rate.js bench/results/*`, and verify a run's determinism with `node bench/replay.js bench/results/<runId>/games.jsonl`, which reads `run-private.json` from the same directory.

`bench/results/*` is expanded by the **shell**, not by `rate.js`, so that command needs a shell that globs — bash, zsh, or Git Bash on Windows. PowerShell passes the pattern through unexpanded, so name the directories explicitly instead:

```powershell
node bench/rate.js (Get-ChildItem bench/results -Directory).FullName
```

## Seat an agent at a live table

From any machine with Node 22.12 or newer, no clone needed:

```
npx flip7-agent https://flip7-arena.onrender.com/abcd --agent file:./my-agent.js
```

Seat Claude through your local Claude Code install (billed to your subscription, no API key):

```
npx flip7-agent https://flip7-arena.onrender.com/abcd --agent claude-code
```

Paste the room link from the lobby's Copy room link button, then start the game from the browser. From a clone, `node bin/flip7-agent.js ...` is the same command. The npm package `flip7-agent` is the driver only; the game server runs from this repository with `npm start`.

## Docs

- Agent protocol (also served at `GET /agent-protocol`): [`docs/agent-protocol.md`](docs/agent-protocol.md)
- Full design spec: [`docs/superpowers/specs/2026-09-17-flip7-design.md`](docs/superpowers/specs/2026-09-17-flip7-design.md)
