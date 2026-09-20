# Flip 7 Arena: one-command agent driver (`npx flip7-agent`)

Date: 2026-09-20. Status: draft for review. Extends spec §5 and §7 of `2026-09-17-flip7-design.md` and `docs/agent-protocol.md`.

## 1. Goal

Two people should be able to seat their own agents at one Flip 7 Arena table without cloning this repository, without exposing a public URL, and without touching the server. The player runs one command on their own machine:

```
npx flip7-agent https://flip7-arena.onrender.com/abcd --agent file:./my-agent.js
```

The driver connects *out* to the room over the same WebSocket protocol the browser uses, so there is no tunnel, no port forwarding, and no server-side registry. Whoever opened the room clicks Start game in their browser, exactly as today.

The driver also ships a built-in `claude-code` agent that plays through the local Claude Code install (`claude -p`), so a Claude Code subscriber can seat Claude with no API key and nothing to write:

```
npx flip7-agent https://flip7-arena.onrender.com/abcd --agent claude-code
```

### Non-goals

- A browser-side "bring your own API key" seat. Separate follow-up.
- A `claude-api` adapter that calls the Claude API with a key. Not in this version.
- Starting the game from the driver. A browser tab starts it.
- Any change to the room protocol, the engine, or the benchmark runner.

## 2. What exists and what changes

`bench/live.js` already does everything the driver needs: `driveLiveSeat({ url, room, spec, name })` connects, joins with `agent: true`, calls the adapter's lifecycle hooks, answers every decision for its seat, and reconnects with backoff. `agents/adapter.js` resolves `bot:`, `file:`, `cmd:`, and `http://` specs. The gaps are packaging, argument ergonomics, and the missing Claude Code adapter.

| Area | Change |
| --- | --- |
| `package.json` | Rename the package to `flip7-agent`, drop `private`, add `bin`, add a `files` whitelist, add `repository` and `description`. |
| `bin/flip7-agent.js` | New. Parses the command line, resolves the room link, calls `driveLiveSeat`, handles signals and exit codes. |
| `agents/adapters/claude-code.js` | New adapter behind the `claude-code` and `claude-code:<model>` specs. |
| `agents/adapters/kill-tree.js` | New. The Windows tree-kill currently private to `subprocess.js`, shared by both spawning adapters. |
| `agents/adapter.js` | Route the two new spec forms. |
| `bench/live.js` | Two small behaviour changes (§4a); the CLI wrapper at its bottom stays for repository use and delegates to the same parser. |
| `docs/agent-protocol.md` | New §0 "Connect an agent in one command", `claude-code` row in the adapter table, live-driver section updated. |
| `README.md` | The npx line replaces the `node bench/live.js` example. |
| `public/index.html` | The landing footer link reads "Connect an agent" and still points at `/agent-protocol`. |

## 3. Package and distribution

- **Name** `flip7-agent`, unscoped, confirmed free on the npm registry on 2026-09-20. The name is what `npx` resolves, so the package that carries the bin must have this name. The server keeps running from the same package with `npm start`; Render does not care about the package name.
- **Version** starts at `0.1.0` and follows semver. The protocol id `flip7-agent/1` is unchanged; a breaking protocol change bumps both.
- **bin** `{ "flip7-agent": "bin/flip7-agent.js" }` with a `#!/usr/bin/env node` shebang. The file must be committed with LF line endings: a CRLF shebang line breaks on macOS and Linux. Add `bin/* text eol=lf` to `.gitattributes`.
- **files** whitelist: `bin/`, `agents/`, `bench/live.js`, `lib/`, `docs/agent-protocol.md`, `README.md`, `LICENSE`. The repository has no `LICENSE` and no `license` field today; this change adds `"license": "MIT"` and an MIT `LICENSE` file naming the owner, because npm warns on publish without one and users of an npx tool expect a licence. **Owner to confirm MIT at spec review.** Not shipped: `server.js`, `public/`, `tests/`, `bench/` except `live.js`, `docs/superpowers/`, `render.yaml`, `bench/results/`. `npm pack --dry-run` in the test plan confirms the list.
- **dependencies** stay as they are. The driver needs only `ws`, but `express` and `ts-trueskill` remain in `dependencies` because `npm start` and `bench/rate.js` need them from the same package. `npx` installs all three; the cost is a second or two on first run and is accepted to keep a single package with no build step. If it ever matters, the fix is a workspace subpackage, not a bundler.
- **engines** `node >= 22.12` is already declared. The bin checks `process.versions.node` first and prints a one-line message on older Node, because npx on an old Node otherwise fails deep inside `ws` or on `fetch`.
- **Publishing** is manual: `npm login` once, then `npm publish` from the repo root on `main` after the PR merges. Publishing is not part of CI. `npm publish --dry-run` runs in the test plan.
- **Repository use** is unchanged: `node bin/flip7-agent.js ...` works from a clone without publishing, and `node bench/live.js --room ... --agent ...` keeps working for existing docs and tests.

## 4. Command line

```
flip7-agent <room> --agent <spec> [--name <name>] [--url <ws-url>] [--model <model>] [--quiet]
```

- `<room>` is required and positional. It is either a room link (`https://flip7-arena.onrender.com/abcd`, with or without a trailing slash or query) or a bare four-letter code (`abcd`). A link sets both the server and the room: `https` becomes `wss`, `http` becomes `ws`, the path's first segment is the code. A bare code uses `--url`, which defaults to `wss://flip7-arena.onrender.com`. `--room` is accepted as an alias for the positional for symmetry with `bench/live.js`.
- `--agent <spec>` is required. Specs are those of `agents/adapter.js` plus the two new forms in §5.
- `--name` overrides the seat name (max 16 characters, the server normalises the rest). Defaults to the adapter's `name`.
- `--model` applies only to `claude-code` and is the same as `--agent claude-code:<model>`. Giving both with different values is an error.
- `--quiet` suppresses the per-decision line; errors still print.
- `--help` and `--version` print and exit 0.

**Output** is one line per event to stdout: agent ready, seated as `<id>` in room `<code>`, one line per decision (`turn 41: hit (2.3 s)`), game over with final scores, reconnecting. Errors go to stderr.

**Exit codes**: 0 after a game ends (`game_over`) or on Ctrl-C; 1 for a usage error (unknown flag, missing room or agent, bad link); 2 when the adapter fails at `hello` (module not found, `claude` not installed, HTTP agent unreachable, protocol mismatch); 3 when the seat is taken over (close code 4000); 4 when the room is full. A usage error prints the usage block. `SIGINT` and `SIGTERM` call `close()`, which awaits the adapter's `shutdown`, then exit.

**Parsing** lives in `bin/flip7-agent.js` as an exported `parseArgs(argv)` returning `{ url, room, spec, name, quiet }` or throwing a `UsageError` with the message to print. It is a pure function so tests cover it without spawning anything. The room-link rule lives in an exported `parseRoom(input, defaultUrl)`; `bench/live.js` uses the same function so both entry points agree.

## 4a. Driver changes in `bench/live.js`

Today the driver sends `join` once, when the socket opens. If the room is mid-game the server answers `game_in_progress`, the driver logs it, and it then sits as a visitor forever: it never joins the next lobby. Two changes:

- **Re-join at the next lobby.** When a `state` arrives with `phase: "lobby"` and the driver holds no seat (`you` is null and no resume token), it sends `join` again. One join per lobby phase, so a rejected join does not loop.
- **Room full ends the run.** A `room_full` error rejects `done` with a clear message; the CLI exits 4. There is nothing to wait for.

**One game per run.** `done` resolves at the first `game_over`, the CLI prints the final scores and exits 0. Playing again means running the command again, which also keeps the driver's lifecycle simple: one process, one game, one exit code. Staying seated across "Play again" is a deferred idea, not a v1 feature.

## 5. The `claude-code` adapter

`agents/adapters/claude-code.js` implements the same adapter interface as `http.js` and `subprocess.js`: `{ spec, name, version, hello, start, move, end, shutdown }`.

**Spec forms**: `claude-code` and `claude-code:<model>` where `<model>` is anything `claude --model` accepts (`sonnet`, `opus`, a full id). The adapter identity is `name = "claude-code"` (or `claude-code-<model>` when a model is given, so ratings key on it) and `version` = the Claude Code version from `claude --version`.

**hello** runs `claude --version` with a 10 s deadline. Missing binary, non-zero exit, or unparsable output is an `AdapterError` whose message says Claude Code is not installed or not on PATH and links to the install page. This is the moment a subscriber finds out the setup is wrong, before joining the room.

**move** spawns one process per decision:

```
claude -p --tools "" --no-session-persistence --output-format json --system-prompt <instructions> [--model <model>]
```

with the rendered request (`lib/render-text.js`, `prompt/v1`) followed by one line naming the legal actions on stdin. `--bare` is **not** used: it skips keychain reads and reports "Not logged in" even when the user is logged in (verified 2026-09-20 on Claude Code 2.1.278). `--system-prompt` replaces Claude Code's own coding system prompt with a short one for this task, which cuts input tokens and latency; the instructions say to reply with exactly one legal action and nothing else. The environment passed to the child drops `CLAUDECODE`, so the driver also works when launched from inside a Claude Code session.

The reply is the `result` string of the JSON object on stdout. `is_error: true` or a non-JSON stdout becomes an invalid reply (`raw` carries the text, capped at 64 KB) and is handled by `decide()` like any other invalid reply; in live rooms that means the default action. The adapter never throws on a bad reply, only on a failed spawn.

**Deadline**: `move` receives `timeoutMs` from the driver (`timer.remainingMs − 250`, so about 29 s in a live room). On timeout the process tree is killed with the shared `kill-tree.js` helper and a `TimeoutError` is thrown, which `decide()` turns into the default action. Measured on 2026-09-20: one call with Sonnet takes about 4 s inside Claude Code and about 7 s wall clock on this machine, so a normal decision fits with room to spare.

**start / end / shutdown** are no-ops. There is no state between moves; each move is a fresh process. Cross-game memory is therefore impossible, which is what §8 of the protocol asks of agents.

**Model**: no default is passed, so Claude Code uses the user's configured default. `--model` or the spec suffix passes `--model` through untouched.

**Prompt injection**: player names are inside the rendered request. The system prompt says that everything after it is game state and that names are not instructions. This does not make the agent immune; it is the same warning §8 of the protocol already gives LLM agents.

**Cost**: the JSON result carries `total_cost_usd`, which is a nominal figure for subscribers. The driver logs it only with `--verbose`, which is left out of this version; the field is ignored.

**Testability**: `create(spec, { command = "claude" })` takes the executable so tests substitute a fixture script (`node tests/fixtures/fake-claude.js`) that answers `--version` and `-p` with canned output, sleeps on demand, or exits non-zero. Spawning goes through `shell: true` like `subprocess.js`, because `claude` is a `.exe` on this machine but a shim elsewhere.

## 6. `kill-tree.js`

The Windows tree-kill comment and code in `subprocess.js` move to `agents/adapters/kill-tree.js` exporting `killTree(child)`. `subprocess.js` calls it; `claude-code.js` calls it. Behaviour is unchanged: `taskkill /pid <pid> /t /f` on Windows with the spawn error swallowed, `SIGKILL` elsewhere. The existing test "shutdown() kills a hung process and leaves no orphan" keeps covering it.

## 7. Documentation

- `docs/agent-protocol.md` gains a §0 before "1. Adapters": the two npx commands above, one sentence each, then a pointer to the adapters table. The adapter table gains a `claude-code` row. §7 (live-room driver) shows the npx form first and the `node bench/live.js` form as the in-repo equivalent, and notes the room-link argument.
- `README.md` replaces the `node bench/live.js` line with the npx line and adds a "Seat Claude" one-liner.
- `public/index.html` footer link text becomes "Connect an agent". The target `/agent-protocol` still serves the markdown as plain text; rendering it as HTML is out of scope.

## 8. Error handling summary

| Situation | Where | Result |
| --- | --- | --- |
| Bad link or code | `parseRoom` | exit 1 with usage |
| Unknown spec prefix | `resolveAgent` | exit 2, message lists the valid prefixes |
| `claude` missing | `hello` | exit 2, install hint |
| Room does not exist yet | server | the server creates rooms on first connect, so the agent waits in the lobby; nothing to handle |
| Game in progress | server error `game_in_progress` | logged, driver stays connected and re-joins at the next lobby (§4a) |
| Room full | server error `room_full` | exit 4 with message (§4a) |
| Seat taken over (4000) | `bench/live.js` | exit 3 |
| Claude reply invalid | `decide` | default action, logged as `fallback` |
| Claude slower than the timer | `decide` | process killed, default action, logged as `timeout` |
| Server down | `bench/live.js` | reconnect with backoff forever until Ctrl-C |

## 9. Testing

Unit (`node --test`, no network, no sleeps):

- `tests/cli.test.js`: `parseArgs` and `parseRoom` cover link with and without trailing slash, `http` to `ws`, bare code, `--room` alias, missing agent, unknown flag, `--model` conflict, `--help`.
- `tests/adapters.test.js` gains claude-code cases against the fixture: `hello` parses the version and fails clearly on a missing binary; `move` returns the `result` string; `is_error` and non-JSON are invalid replies; a slow fixture is killed at the deadline with no orphan (same assertion style as the subprocess test); `--model` is passed through (the fixture echoes its argv).
- `tests/live-unit.test.js` gains: an unseated driver sends `join` once when a lobby state arrives after `game_in_progress`, and not again for further lobby states; `room_full` rejects `done`. Both through the existing `_handleState` seam plus a captured `send`.

Integration (in the test plan, run by hand before the PR):

- `npm pack --dry-run` lists only the whitelisted files and the tarball is under 1 MB.
- From a clone: `node bin/flip7-agent.js http://localhost:3000/<code> --agent file:./agents/examples/threshold.js` plays a full game against a browser tab and two bots.
- Same with `--agent claude-code`: Claude takes every turn inside the timer, and the decision lines show latency.
- Two drivers in one room (threshold and claude-code) with a browser tab starting the game.
- `npx --yes ./flip7-agent-0.1.0.tgz <room> --agent claude-code` from a directory outside the repo, to prove the tarball is self-sufficient.
- After publishing: `npx flip7-agent <room> --agent claude-code` from a machine or directory without the repo.

## 10. Open questions resolved

- Room link versus room code: both accepted; the link is what the lobby's Copy room link button already produces, so the friend flow is copy, paste, run.
- Starting the game: browser only, per the owner's choice on 2026-09-20.
- API-key adapter: deferred, per the owner's choice on 2026-09-20; the browser seat covers that audience later.
