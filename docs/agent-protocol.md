# Flip 7 agent protocol (`flip7-agent/1`)

This is the normative document for third parties writing an agent for Flip 7. It is served at `GET /agent-protocol` and mirrors spec §5 of `docs/superpowers/specs/2026-09-17-flip7-design.md`. Protocol id: `"flip7-agent/1"`. Any breaking change bumps the id.

## 1. Adapters

An agent spec string selects the adapter:

| Spec | Adapter | Contract |
| --- | --- | --- |
| `bot:<name>` | in-process | a baseline from `lib/bots.js` |
| `file:./path.js` | in-process | module exports `{ name, version, act(request) -> action \| Promise<action>, start?(info), end?(result) }` |
| `cmd:"python agent.py"` | subprocess | JSONL over stdin/stdout, one JSON object per line |
| `http://host:port` | HTTP | `POST /move` with the request, JSON reply |

**Identity.** Every agent has a `name` and a `version` string; in-process modules export them, HTTP agents return them from `GET /`, subprocess agents include them in their reply to `start`. Logs and ratings key on `name@version`.

**Lifecycle**, identical across adapters:

| Hook | When | Payload | Deadline | On failure |
| --- | --- | --- | --- | --- |
| `hello` | once per run | — | 10 s | run aborts |
| `start` | once per game | `{ type: "start", protocol, game_id, you, players: [{id, name, seat}] }` | 10 s | run aborts |
| `move` | once per decision (plus one retry) | `{ type: "move", request_id, request }` | `timeout_ms` | §4 below |
| `end` | once per game | `{ type: "end", game_id, result: { final_scores, winner, rounds } }` | 10 s | logged, ignored |
| `shutdown` | once per run | — | 2 s | forced |

- **In-process:** `hello` loads the module; `start`/`end` call the optional hooks; `shutdown` is a no-op. A promise still pending after its deadline is ignored when it settles.
- **Subprocess:** one process per run, spawned at `hello`. Runner → agent lines are the payloads above; the agent answers `hello` with `{"name","version","protocol"}` and each `move` with `{"request_id","action"}`; it may answer `start`/`end` with anything or nothing. Replies are matched by `request_id`; a reply with an unknown or already-settled `request_id` is logged and discarded, so a late answer can never be consumed by the next move. A line with no `request_id` at all (non-JSON, or JSON without the field) is attributed to the single pending request when exactly one is pending and judged invalid, and discarded otherwise — always echo `request_id`. Stdout lines over 64 KB are an invalid reply. Stderr is captured into the log, capped at 1 MB per run. `shutdown` closes stdin, waits 2 s, then kills. If the process exits during a run, the run aborts with its exit code and last stderr.
- **HTTP:** `hello` is `GET /` → `{ "name", "version", "protocol" }` (a protocol mismatch aborts the run). `start` and `end` are `POST /start` and `POST /end` with the payload as the body; replies are ignored. `move` is `POST /move` with `{ "request_id", "request" }`; the reply must be status 200 with JSON `{ "action" }` (`request_id` optional), at most 64 KB. Any other status, a non-JSON body, or a connection error is an invalid reply. A reply after the deadline is a timeout and the connection is dropped.

The request and action are byte-identical across all three adapters.

## 2. Request and game view

A **request** is what an agent receives for a decision. Its `game` field is the game view, exactly what the browser renders.

```json
{
  "protocol": "flip7-agent/1",
  "request_id": "7f3a9c",
  "game_id": "k3m9x2q",
  "timeout_ms": 30000,
  "retry": null,
  "game": {
    "round": 3,
    "turnNumber": 41,
    "you": "p2",
    "target_score": 200,
    "dealer": "p1",
    "decision": { "type": "hit_or_stay" },
    "legal_actions": ["hit", "stay"],
    "players": [
      { "id": "p1", "name": "threshold25", "seat": 0, "score": 87, "status": "stayed",
        "numbers": [3, 7, 12], "modifiers": ["x2"], "second_chance": false,
        "round_score": 44, "unique_count": 3 },
      { "id": "p2", "name": "you", "seat": 1, "score": 61, "status": "active",
        "numbers": [0, 5, 9, 11], "modifiers": ["+4"], "second_chance": true,
        "round_score": 29, "unique_count": 4 }
    ],
    "deck_remaining": 41,
    "discard": [7, "+2", "freeze", 7, 3],
    "resolution": [],
    "history": [ { "type": "hit", "player": "p1", "card": 12, "turnNumber": 39 } ]
  }
}
```

Field meanings:

- `protocol` — always `"flip7-agent/1"`.
- `request_id` — opaque id for this attempt; echo it back in the reply (subprocess and, optionally, HTTP).
- `game_id` — an opaque random id. It does not encode the seed, suite index, or rotation; the mapping lives only in the runner's private log header.
- `timeout_ms` — the deadline for this attempt.
- `retry` — `null` or `{ "attempt": 2, "reason": "illegal action \"hitt\"; legal: hit, stay", "previous": "<raw previous reply>" }` on the one retry (§4).
- `game.decision` — `{ "type": "hit_or_stay" }` or `{ "type": "choose_target", "card": "freeze", "candidates": ["p1", "p3"] }`. In the latter case `legal_actions` is `["target:p1", "target:p3"]`.
- `game.legal_actions` — the exact set of valid replies for this decision.
- `game.players[].round_score` — §2.5 of the spec applied to that player's line now.
- `game.discard` — every card in the discard pile in the order discarded. `game.resolution` is the public resolution stack (§4.3 frames of the spec, with `remaining` and `setAside`). Cards in the deck are exactly the 94 minus every line minus `discard`.
- `game.history` — the last 40 engine events of this round; the runner's log has all of them.

`lib/render-text.js` renders a request as text for LLM prompts. The template is versioned (`prompt/v1`); the version and a hash of the rendered text are logged with each attempt so results can be attributed to prompt changes. Nothing in v1 calls an LLM; this exists so third-party LLM agents start from a common prompt.

## 3. Action

`{ "action": "hit" }`, `{ "action": "stay" }`, or `{ "action": "target:p3" }`. Optional `"reasoning": "<string>"` (capped at 8 KB) is stored in the log and otherwise ignored. In-process agents may return the bare string.

## 4. Invalid moves and timeouts

Each `move` is an **attempt**. An attempt's outcome is one of `ok`, `invalid` (not JSON, no `action`, or an action not in `legal_actions`), or `timeout` (no valid reply within `timeout_ms`, uniformly across adapters).

1. On a first `invalid` attempt the agent is asked once more with `retry` populated and a fresh `request_id`. A `timeout` is never retried.
2. If the second attempt is not `ok`, or the first was a `timeout`, the runner applies `defaultAction(request)` from `lib/defaults.js`: `stay` for hit-or-stay; for target choices, the bots' targeting rule (spec §6.2). The game continues. Nobody forfeits, because a forfeit in a four-player round-based game distorts every other seat's result.
3. Every attempt is logged with its outcome; `fallback_used` marks the decision.

Live rooms use the same outcomes with `TURN_MS` as the deadline and no retry, because a human is waiting.

## 5. Quick start

Three example agents ship under `agents/examples/`, one per adapter:

```
node bench/run.js --agent file:./agents/examples/threshold.js --suite smoke
```

```
node agents/examples/http-server.js 8080
node bench/run.js --agent http://localhost:8080 --suite smoke
```

```
node bench/run.js --agent "cmd:python agents/examples/subprocess.py" --suite smoke
```

Each writes `bench/results/<runId>/games.jsonl` and `summary.json`.

## 6. Reading `summary.json` and `bench/rate.js`

`bench/metrics.js` computes, for the agent under test and for every other seat: `win_rate`, `points_vs_table`, `mean_score_per_round`, `bust_rate`, `flip7_rate`, `mean_hits_per_round`, `rounds_per_game`, `invalid_attempt_rate`, `decisions_with_fallback_rate`, `timeout_rate`, and `latency_ms` (mean, p50, p95). See spec §6.4 for exact definitions.

**Uncertainty.** The unit of independence is the **seed block** (all rotations of one seed). Every rate and mean is first aggregated within each seed block, then a 95% interval is computed by a percentile bootstrap over seed blocks (2,000 resamples, seeded, so the interval itself is reproducible). The summary reports `n_seeds` as the effective sample size alongside `n_games`. No Wilson or normal-approximation intervals are used.

`win_rate` and `points_vs_table` are reported separately because published simulations show aggressive policies can win more games with fewer mean points. `points_vs_table` is the headline luck-adjusted skill number; `win_rate` is the headline outcome.

`node bench/rate.js bench/results/*` reads every `game_end` across the given runs, keeps games where every seat is a named agent (`--agents` runs and bot-only runs), deduplicates by `game_id`, orders games deterministically by `(run started_at, game_start order)`, and computes TrueSkill (via `ts-trueskill`, μ=25, σ=25/3, β=25/6, τ=25/300, draw probability 0.02) with each game as a free-for-all ranked by final score, ties sharing a rank. Identity is `name@version`. It prints `name, version, mu, sigma, conservative = mu − 3σ, games` and writes `ratings.json`. It warns if any agent is not connected to at least one baseline bot through played games, because a disconnected rating is not comparable. TrueSkill's σ treats rotations as independent and is therefore optimistic; the seed-block bootstrap in `summary.json` is the honest uncertainty for a single agent.

## 7. Live-room driver (`bench/live.js`)

An agent can also join a live room as a WebSocket client, using the same protocol as the browser (spec §4.6). This is how an agent plays against humans or live bots instead of a benchmark suite.

```
node bench/live.js --url ws://localhost:3000 --room abcd --agent <spec> [--name my-agent]
```

`driveLiveSeat({ url, room, spec, name, log })` connects to `<url>/ws?room=<room>`, calls `hello` once, then sends `join { name, agent: true }`. It calls the adapter's `start` hook on the first playing state of each game and `end` on `game_over`. On every `state` message where `game.decision` is set, `game.current_player` is this seat, and the turn has not already been answered, it calls `decide` with `timeoutMs = max(1, timer.remainingMs − 250)` and retry disabled (a human or another agent is waiting, so there is no second attempt), then sends `act { turnNumber, action }`. States that arrive while a decision is still in flight are not dropped: the newest one is reprocessed once the current decision settles, so a turn the server already defaulted is never answered late. It reconnects with the same backoff as the browser (1 s × 1.5, capped at 5 s) on every socket close except code `4000` (seat taken over by a resume, which means stop). `close()` cancels any pending reconnect and awaits the adapter's `shutdown`.

The room shows an "agent" badge on the seat, and a connected agent counts as an occupant for room lifetime (spec §4.5) — the room is not deleted just because no human is connected.

The runner's error code list for live rooms includes `not_enough_players` when `start-game` is sent with fewer than 2 seated players.
