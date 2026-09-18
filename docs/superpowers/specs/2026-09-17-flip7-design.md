# Flip 7 — design spec

**Date:** 2026-09-17
**Status:** draft for review
**Scope:** v1 of a real-time multiplayer Flip 7 website plus an agent-playable harness and benchmark.

## 1. What this is

Flip 7 is a press-your-luck card game: on your turn you either **hit** (flip one more card) or **stay** (bank what is in front of you). Flip a number you already have and you bust for zero. Flip seven different numbers and you score a bonus and end the round for everyone. First to 200 wins.

This project is two things built on one rules engine:

1. **A website** at `C:\dev\flip7`, built like `follow-suit/`: Express 5 plus raw WebSockets, vanilla JS in the browser, no build step, deployed on Render. People play in real time in 4-letter rooms, alone against bots or with friends.
2. **An agent harness and benchmark.** The same engine runs headless. Any program that can read a JSON observation and answer with a JSON action can sit at the table, through one of three adapters (in-process function, subprocess over JSONL, HTTP URL). A runner plays seeded suites against baseline bots, logs every decision, and reports how good the agent is. Agents can also take a seat in a live room over the browser's own WebSocket protocol.

The engine, the observation an agent sees, and the state the browser renders are the same object. There is no second rules implementation to drift.

Out of scope for v1: accounts, persistence of results, an LLM reference agent (the harness ships a stub and examples only), spectators, chat, custom domain, sound, native apps, rule variants.

## 2. Game rules

Sources: the publisher FAQ (theop.games/pages/flip-7-faqs) and the Dized rules FAQ. Where sources are silent, §2.9 records the ruling this implementation makes.

### 2.1 The deck

94 cards.

| Kind | Cards | Count |
| --- | --- | --- |
| Number | one 0, one 1, two 2s, three 3s, … twelve 12s | 79 |
| Modifier | +2, +4, +6, +8, +10 (one each), ×2 (one) | 6 |
| Action | Freeze ×3, Flip Three ×3, Second Chance ×3 | 9 |

Card encoding, used everywhere (engine, wire, logs): numbers are integers `0`–`12`; modifiers are the strings `"+2"`, `"+4"`, `"+6"`, `"+8"`, `"+10"`, `"x2"`; actions are `"freeze"`, `"flip_three"`, `"second_chance"`.

### 2.2 Players and seating

2 to 6 players. The physical game says 3+, but 2 works and quick play needs it. Seats are ordered; play proceeds to the next seat, wrapping. Benchmark tables default to 4 players.

### 2.3 A round

1. **Deal.** Starting with the seat after the dealer, each player is dealt one card face up. If it is an action card, dealing pauses, the card is resolved (§2.5), then dealing continues. A player frozen during the deal has banked and is out for the round even if they received no number card.
2. **Turns.** Starting with the seat after the dealer, each **active** player (not busted, stayed, or frozen this round) takes one turn: **hit** or **stay**. Hitting flips exactly one card from the deck. If that card is an action card, it is resolved. Either way the turn then ends and play moves to the next active seat. A player may always stay on their turn; they always hold at least one card by then.
3. **Bust.** A flipped number that matches a number already in front of that player is a bust: the player discards everything in front of them and scores 0 this round. A held Second Chance prevents this once (§2.5).
4. **Flip 7.** The moment a player has seven distinct numbers in front of them, they score a +15 bonus and **the round ends immediately for everyone**. No further cards are flipped, including any remaining Flip Three cards. Modifier and action cards do not count toward the seven.
5. **Round end.** The round also ends when no active players remain. Every player who did not bust banks their round score.

### 2.4 Round score

Computed at round end for a player who did not bust, in this order:

1. Sum of number cards.
2. If ×2 is held, double that sum. ×2 doubles number cards only.
3. Add each + modifier.
4. Add 15 if the player flipped seven distinct numbers.

A busted player scores 0, modifiers included. A Second Chance card is worth nothing and is discarded at round end.

Worked examples, which tests assert exactly:

| Numbers | Modifiers | Flip 7 | Score |
| --- | --- | --- | --- |
| 3, 7, 12 | — | no | 22 |
| 3, 7, 12 | ×2 | no | 44 |
| 3, 7, 12 | ×2, +4 | no | 48 |
| 0, 1, 2, 3, 4, 5, 6 | +10 | yes | 46 |
| 0, 1, 2, 3, 4, 5, 6 | ×2, +10 | yes | 67 |
| (busted) | ×2, +10 | — | 0 |
| — (frozen before any number) | +4 | no | 4 |

### 2.5 Action cards

The player who flips an action card (the **drawer**) chooses its target. Legal targets are **active** players, including the drawer. If the drawer is the only active player, they must target themselves.

- **Freeze.** The target immediately banks their current round score and is out for the round. Second Chance does not defend against Freeze.
- **Flip Three.** The target flips the next three cards one at a time, resolving each number and modifier normally. It stops early if the target busts or completes Flip 7. Action cards flipped during a Flip Three:
  - Second Chance: resolved immediately (§2.5 Second Chance below). If the target keeps it, it may save them later in the same Flip Three.
  - Freeze and Flip Three: set aside. After the three cards are flipped, if the target is still active, the target chooses a target for each set-aside card in the order flipped. If the target busted or the round ended, set-aside cards are discarded unused.
  - A Flip Three does not give the target an extra turn. After it resolves, play continues with the seat after the drawer.
- **Second Chance.** The drawer keeps it if they hold none. If the drawer already holds one, they must give it to an active player who holds none; if no such player exists, it is discarded. When a held Second Chance is used, both it and the duplicate number are discarded and the player's turn ends (they are still active).

Every action card is resolved fully, including its target choice, before anything else happens. Choosing a target is a **decision** the engine asks for (§4.3), like hit-or-stay.

### 2.6 The deck runs out

When a card must be flipped and the deck is empty, the discard pile (busted cards, used Second Chances, resolved action cards, and last round's cards) is shuffled to form a new deck. Cards in front of players are not reshuffled. If both the deck and the discard pile are empty, the flip is skipped: a hit becomes a stay and a Flip Three ends early. This cannot happen with the real deck and six players, but the engine must not crash.

### 2.7 Game end

After a round ends, if any player has 200 or more points the game is over and the player with the most points wins. If two or more players are tied for the most, everyone plays another round, repeating until there is a single leader. Otherwise the dealer marker moves one seat and the next round begins. Every player is active again at the start of a round.

### 2.8 Public and private information

Flip 7 is almost fully public. Every card in front of every player, the discard pile, and the number of cards left in the deck are public. The only hidden information is the **order of the deck**, which no player, bot, or agent ever sees. The engine's random state is likewise never exposed. This is enforced in one module, `lib/view.js` (§4.4).

### 2.9 Rulings where the rulebook is silent

- A Freeze dealt during the initial deal may target any player who is not yet frozen, including one who has not been dealt a card. That player scores 0 this round.
- A Second Chance give-away is resolved immediately when flipped, even inside a Flip Three, and the drawer chooses the recipient.
- The set-aside Freeze and Flip Three cards from a Flip Three are targeted by the player who flipped the three cards, not by the player who originally drew the Flip Three.
- Turn order after any action card resolution continues from the seat after the drawer, skipping inactive seats.

## 3. Product surface

### 3.1 Routes

| Route | Serves |
| --- | --- |
| `GET /` | App shell (landing) |
| `GET /how-to-play` | App shell (rules view) |
| `GET /:code` (4 lowercase letters) | App shell (room) |
| `GET /api/new-room` | `{ ok, room }`, reserves the code for 60 s |
| `GET /ws?room=abcd` | WebSocket |
| `GET /agent-protocol` | Static copy of `docs/agent-protocol.md` rendered as plain text |
| `GET /health` | `ok` |

### 3.2 Views

Single app shell, `<section class="view" hidden>` per view, toggled in-document as in follow-suit.

- **Landing.** Name field. **Quick play** (new room, you plus three bots, deals immediately). **Play with friends** (new room, join card with the code and a copy-link button). **Join** a code.
- **Lobby.** Seat list with names, bot and agent badges, connection dots. Any seated player may add or remove a bot, and start with 2 to 6 seats. Target score fixed at 200.
- **Table.** Each player as a row: name, banked score, status badge (active / stayed / busted / frozen), their number cards in ascending order, modifiers, a Second Chance token, and the round score they would bank now. Dealer marker. Deck count and top of discard. Whose turn it is and a countdown. For you, when it is your decision: **Hit** and **Stay** buttons, or a target picker listing legal targets with their scores. A collapsible event log. Card flips animate with a short CSS transition; `prefers-reduced-motion` disables it.
- **Round summary.** Overlay between rounds: what each player banked, the running totals, and a **Next round** button any seated player may press (auto-advances after 8 s).
- **Results.** Final standings, winner, **Play again** (back to lobby with the same seats).
- **How to play.** The rules of §2 in plain language.

### 3.3 Bots in live rooms

Server-side bots occupy seats like players (`isBot: true`). They use the same policies as the benchmark baselines (§6.2), chosen at random from `threshold25`, `bustRisk25`, `adaptive` with a random name. Bots act after a jittered delay of 700 to 1500 ms so the table is readable.

### 3.4 Agents in live rooms

An agent joins a room as a WebSocket client using the same protocol as the browser (§4.6). `bench/live.js` does this for any adapter: it connects, joins with a name, waits in the lobby, and answers every decision the room asks of its seat. Agents get the same turn timer as humans. The room shows an "agent" badge on the seat. No authentication beyond knowing the room code, which is how humans join too.

## 4. Architecture

### 4.1 Stack and repository layout

Node ≥ 22, `express@5`, `ws@8`, and `ts-trueskill` (pure JS, used only by `bench/rate.js`). No other runtime dependencies, no build step, no framework. Server and library code are CommonJS; browser code under `public/js/` is ES modules. `npm test` is `node --test`.

```
flip7/
  server.js                 # env config, Express routes, ws wiring, broadcast
  lib/
    config.js               # readConfig(env): every tunable with its default (single source)
    rng.js                  # seeded PRNG (mulberry32), shuffle
    cards.js                # deck composition, card encoding, scoring
    engine.js               # pure reducer: the rules of §2
    view.js                 # observation for a player: the secrecy boundary
    defaults.js             # default action when an agent fails or times out
    render-text.js          # observation -> versioned text rendering for LLM agents
    bots.js                 # baseline policies as agents: act(observation) -> action
    rooms.js                # room registry, seats, resume tokens, expiry
    room-game.js            # engine + timers + bot/agent driving for one room
    snapshot.js             # room state message for one recipient
  agents/
    adapter.js              # resolveAgent(spec) -> { name, start, act, end }
    adapters/in-process.js  # module exporting { name, act }
    adapters/subprocess.js  # JSONL over stdin/stdout
    adapters/http.js        # POST /move
    examples/threshold.js   # in-process example
    examples/http-server.js # Node HTTP example
    examples/subprocess.py  # Python stdlib example (subprocess adapter)
  bench/
    suite.js                # suite definitions: seeds and seat rotations
    run.js                  # play a suite, write JSONL + summary.json
    metrics.js              # aggregate decisions and games into metrics with CIs
    rate.js                 # TrueSkill over results directories
    replay.js               # re-run a game log through the engine, verify byte-equal
    live.js                 # drive an adapter as a seat in a live room
  public/
    index.html  styles.css
    js/{app,net,landing,lobby,table,results,log}.js
  tests/
  docs/superpowers/specs/   docs/superpowers/plans/
  docs/agent-protocol.md    # the document third parties read
  render.yaml  AGENTS.md  CLAUDE.md  LEARNINGS.md  IDEAS.md
```

### 4.2 Authority and determinism

The server is authoritative in live rooms; the runner is authoritative in benchmarks. Both drive the same `lib/engine.js`.

The engine is a pure reducer: `step(state, input) -> { state, events }` with no I/O and no clock. All randomness comes from a seeded PRNG whose state lives inside `state`. Given a seed and the sequence of player actions, every game replays identically, byte for byte. `bench/replay.js` proves it for every logged game and fails on any divergence.

### 4.3 Engine

```js
createGame({ playerIds, seed, targetScore = 200 }) -> state
step(state, input) -> { state, events }
legalActions(state) -> string[]        // for state.pending, [] if none
pendingPlayer(state) -> playerId | null
```

Inputs:

- `{ type: "start_round" }` — shuffles, deals, and plays forward until a decision is needed or the round ends.
- `{ type: "act", player, action }` — `action` is one of `legalActions(state)`. Any other input throws `IllegalAction`; the caller (room or runner) decides what to do about it.

Actions are strings so single-token agents can answer with just the id: `"hit"`, `"stay"`, `"target:<playerId>"`.

State shape (all fields required, no `undefined`):

```js
{
  seed, rngState, targetScore,
  players: [{ id, seat, score }],          // score = banked total
  dealerSeat, roundNumber, turnNumber,      // turnNumber increments per decision asked
  phase: "lobby" | "round" | "round_over" | "game_over",
  round: {
    deck: [card...],                        // NEVER leaves lib/view.js
    discard: [card...],
    hands: { [id]: { numbers: [], modifiers: [], secondChance: bool,
                     status: "active" | "stayed" | "busted" | "frozen" } },
    turnSeat,                               // whose turn the current decision belongs to
    pending: null | { type: "hit_or_stay", player }
                  | { type: "choose_target", player, card, candidates: [id...] },
    flipThree: null | { player, remaining, setAside: [card...] },
    dealing: null | { nextSeat },           // during the initial deal
    results: null | { [id]: { roundScore, flip7: bool } }
  },
  winner: null | id,
  history: [event...]                       // every event this game, in order
}
```

Events (each `{ type, ...fields, turnNumber }`): `round_started {roundNumber, dealer}`, `dealt {player, card}`, `hit {player, card}`, `stay {player}`, `bust {player, card}`, `second_chance_saved {player, card}`, `second_chance_kept {player}`, `second_chance_given {from, to}`, `second_chance_discarded {player}`, `freeze {from, to}`, `flip_three_started {from, to}`, `flip_three_card {player, card}`, `flip_three_ended {player}`, `set_aside {player, card}`, `flip7 {player}`, `reshuffle {count}`, `deck_exhausted {player}`, `round_ended {results}`, `game_over {winner, scores}`.

The engine advances automatically through everything that is not a decision: it deals, flips Flip Three cards, applies busts and freezes, ends rounds, and only stops when `pending` is set or the phase is `round_over` / `game_over`. Callers never step through card flips one at a time.

### 4.4 The observation (`lib/view.js`)

`observe(state, playerId) -> observation` is the only function that turns engine state into something a player, bot, agent, or browser may see. It is the secrecy boundary: it never copies `round.deck` or `rngState`, and a test asserts those keys are absent in every phase. The observation is the agent protocol's payload (§5.2). The browser renders from the same object.

Bots are structurally incapable of reading the deck: `lib/bots.js` receives observations, never state.

### 4.5 Rooms (`lib/rooms.js`, `lib/room-game.js`, `lib/snapshot.js`)

Copied from follow-suit's design, so only the differences are listed.

- Room code: 4 random lowercase letters, reserved 60 s by `/api/new-room`, room object created on first socket attach. Socket at `/ws?room=abcd`; the room is fixed for the socket's life.
- Seats: `{ id, name, isBot, isAgent, resumeToken, ws, connected, disconnectedAt }`. A resume token is minted on join and stored by the browser in `localStorage` under `flip7:token:<room>`. Resume adopts the seat unconditionally and closes the displaced socket with code 4000; clients never auto-reconnect on 4000. Message and close handlers bail if `seat.ws !== ws`. Every message handler re-resolves its room from the registry first.
- No host. Any seated player may add or remove bots, start, advance a round, or return to the lobby.
- `room-game.js` wraps the engine for one room: it owns the turn timer, drives bots and default actions, and calls `onChange` after every engine step. It maps seat ids to engine player ids one to one.
- **Turn timer.** One pending timer per room, armed whenever the engine sets `pending`. It carries the `turnNumber` it was armed for and no-ops if the engine has moved on. On expiry, the room applies `defaultAction(observation)` (§5.4) for that player and logs a `timeout` event in the room log (not in engine history). Humans, agents, and bots all share `TURN_MS`; bots act well before it.
- **Disconnects.** A disconnected human keeps their seat for the whole game; their decisions fall to the timer. Seat expiry runs only in `lobby` and `results`. A room with no connected human for `RESUME_TTL_MS` is deleted in any phase. A room of only visitors is deleted when the last visitor leaves.
- Broadcast is a full per-recipient snapshot on every change. No diffs.

### 4.6 Wire protocol

Client → server:

| type | fields | notes |
| --- | --- | --- |
| `resume` | `resumeToken` | adopt a seat |
| `join` | `name`, `resumeToken?`, `agent?: true` | seat or adopt; `agent` sets the badge |
| `quick-play` | `name`, `resumeToken?` | seat; if the room was empty, add 3 bots and start |
| `add-bot` | — | seated, lobby only |
| `remove-bot` | `playerId` | seated, lobby only |
| `start-game` | — | seated, lobby, 2–6 seats |
| `act` | `turnNumber`, `action` | the decision for `turnNumber`; stale or illegal → `error` |
| `next-round` | — | seated, `round_over` only |
| `return-to-lobby` | — | seated, `game_over` only |

Server → client:

| type | fields |
| --- | --- |
| `joined` | `playerId`, `resumeToken` |
| `state` | see below |
| `error` | `message`, `code?` (`game_in_progress`, `room_full`, `stale_turn`, `illegal_action`, `not_seated`) |

`state` for a seated recipient:

```js
{ type: "state", room, phase, you: playerId,
  seats: [{ id, name, isBot, isAgent, connected }],
  observation: observe(state, you) | null,   // null in lobby
  timer: { turnNumber, remainingMs } | null,
  roundSummary: { ... } | null, results: { ... } | null }
```

The `observation` is the same object an agent receives (§5.2) including `legal_actions` and `decision` when it is this recipient's decision; `legal_actions` is `[]` otherwise. Visitors receive `{ type: "state", room, phase, you: null, playerCount, maxPlayers }`.

Never included for any recipient in any phase: the deck order, the engine RNG state, any other seat's resume token.

### 4.7 Configuration

Every tunable lives in `lib/config.js` with its default and is read from the environment once at startup. `lib/room-game.js` receives the config object; it does not repeat defaults.

| Env | Default | Meaning |
| --- | --- | --- |
| `PORT` | 3000 | listen port |
| `TURN_MS` | 30000 | time to answer a decision in a live room |
| `BOT_DELAY_MIN_MS` / `BOT_DELAY_MAX_MS` | 700 / 1500 | bot think time in live rooms |
| `ROUND_SUMMARY_MS` | 8000 | auto-advance between rounds |
| `RESUME_TTL_MS` | 600000 | seat expiry in lobby/results and room deletion |
| `CODE_RESERVATION_MS` | 60000 | `/api/new-room` reservation |
| `HEARTBEAT_MS` | 30000 | ws ping/pong sweep |
| `MAX_PAYLOAD` | 16384 | ws frame cap |

## 5. Agent protocol

`docs/agent-protocol.md` is the normative document for third parties; this section is its content. Protocol id: `"flip7-agent/1"`. Any breaking change bumps the id.

### 5.1 Adapters

An agent spec string selects the adapter:

| Spec | Adapter | Contract |
| --- | --- | --- |
| `bot:<name>` | in-process | a baseline from `lib/bots.js` |
| `file:./path.js` | in-process | module exports `{ name, act(observation) -> action \| Promise<action>, start?(info), end?(result) }` |
| `cmd:"python agent.py"` | subprocess | JSONL over stdin/stdout, one JSON object per line |
| `http://host:port` | HTTP | `POST /move` with the observation, JSON reply |

Subprocess messages, runner → agent: `{"type":"start", "protocol", "game_id", "you", "players"}`, `{"type":"move", "observation"}`, `{"type":"end", "result"}`. Agent → runner: one line `{"action": "hit"}` per `move`. The agent may write anything to stderr; it is captured into the log.

HTTP: `GET /` → `{ "name", "protocol" }` (checked once at start; a mismatch aborts the run). `POST /start` and `POST /end` receive the same bodies as the subprocess messages and their replies are ignored. `POST /move` body is `{ "observation": ... }`; reply is `{ "action": "hit" }` with status 200. Any other status, a non-JSON body, or a late reply is an invalid move.

The subprocess and HTTP adapters are the same 30 lines of contract in different transports; the observation and action are byte-identical across all three.

### 5.2 Observation

```json
{
  "protocol": "flip7-agent/1",
  "game_id": "std-0007-r2",
  "seed": 1830491,
  "round": 3,
  "turn": 41,
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
  "deck": { "remaining": 41, "discard": [7, "+2", "freeze", 7, 3] },
  "history": [ { "type": "hit", "player": "p1", "card": 12, "turn": 39 } ],
  "timeout_ms": 30000,
  "retry": null
}
```

- `decision` is `{ "type": "hit_or_stay" }` or `{ "type": "choose_target", "card": "freeze", "candidates": ["p1", "p3"] }`. In the latter case `legal_actions` is `["target:p1", "target:p3"]`.
- `round_score` is what the player would bank if the round ended now (§2.4, without the Flip 7 bonus unless earned).
- `deck.discard` is every card in the discard pile in the order discarded, so bust odds are computable: cards not in `discard` and not in front of any player are in the deck.
- `history` is the last 40 engine events of this round; the runner's log has all of them.
- `retry` is `null` or `{ "attempt": 2, "reason": "illegal action \"hitt\"; legal: hit, stay", "previous": "<raw previous reply>" }` on the one retry (§5.4).

`lib/render-text.js` renders an observation as text for LLM prompts. The template is versioned (`prompt/v1`); the rendering's version and a hash of the rendered text are logged with each decision so results can be attributed to prompt changes. Nothing in v1 calls an LLM; this exists so third-party LLM agents start from a common prompt.

### 5.3 Action

`{ "action": "hit" }`, `{ "action": "stay" }`, or `{ "action": "target:p3" }`. Optional `"reasoning": "<string>"` is stored in the log and otherwise ignored. In-process agents may return the bare string.

### 5.4 Invalid moves and timeouts

1. A reply that is not JSON, has no `action`, or names an action not in `legal_actions` is **invalid**. A reply after `timeout_ms` is a **timeout**.
2. On the first invalid reply the agent is asked once more with `retry` populated. A timeout is not retried.
3. On the second invalid reply, or on timeout, the runner applies `defaultAction(observation)` from `lib/defaults.js`: `stay` for hit-or-stay; for target choices, the same rule the bots use (§6.2 targeting). The game continues. Nobody forfeits, because a forfeit in a four-player round-based game distorts every other seat's result.
4. Every invalid reply, timeout, and fallback is logged per decision and reported as an instruction-following metric separate from skill.

Live rooms use the same policy with `TURN_MS` as the timeout and no retry, because a human is waiting.

## 6. Benchmark

### 6.1 Suites

A suite is a list of seeds and a table size. `bench/suite.js` defines `standard`: table of 4, 50 seeds, `seed_i = fnv1a("standard:" + i)`, each seed played once with the agent in each of the 4 seats (**seat rotation**), so 200 games. The opponents' policies also rotate with the seats, so every seed is played under four seatings of the same deck order. Rotation cancels most card luck; the agent's mean over a seed is compared against the bots' means over the same seed. `--seeds N` and `--table K` override for smaller or larger runs. A `smoke` suite of 3 seeds exists for tests and CI.

The deck order for a given seed is identical no matter who sits where, because the engine shuffles from the seed and seats are only labels.

### 6.2 Baseline bots

All in `lib/bots.js`, all pure functions of the observation plus an injected RNG for `random`. Each is an in-process agent and is also what live rooms use.

| Name | Hit-or-stay policy |
| --- | --- |
| `random` | uniform over `legal_actions` |
| `threshold25` | hit while `round_score < 25` |
| `bustRisk25` | hit while (live duplicates of held numbers ÷ unseen cards) < 0.25; treat a held Second Chance as risk 0 |
| `evOneStep` | hit iff expected round score after one more card, from unseen-card counts, exceeds the current round score |
| `adaptive` | `bustRisk` with threshold `0.25 + 0.002 × (leader_score − my_score)`, clamped to [0.10, 0.45]; stays as soon as banking would cross 200 while leading |

Unseen cards = deck composition minus `discard` minus every card in front of every player. This is public information (§2.8).

Shared **targeting** rule (`lib/bots.js`, also used by `lib/defaults.js`): Freeze → the active candidate with the highest `score + round_score` other than self if any, else self. Flip Three → self if own `unique_count ≤ 2`, else the candidate with the highest `score + round_score` other than self, else self. Second Chance give-away → the candidate with the lowest `score`.

Expected calibration, from published simulations: a solved solo policy scores about 22 points per round with a 32 % bust rate; `threshold25` should land within a few points of that. `tests/bots.test.js` asserts each bot's mean round score over the `smoke` suite falls in a documented band, so a rules bug that shifts scoring is caught.

### 6.3 Runner

```
node bench/run.js --agent http://localhost:8080 [--suite standard] [--seeds 50] [--table 4]
                  [--opponents threshold25,bustRisk25,adaptive] [--timeout 30000]
                  [--name my-agent] [--out bench/results]
node bench/run.js --agents file:./a.js,file:./b.js,bot:adaptive,bot:threshold25   # all seats named
```

`--agent` is the seat under test; the rest of the table is filled from `--opponents` in order. `--agents` names every seat for head-to-head runs; TrueSkill needs these. The runner plays every game of the suite, calling adapters in the seat's turn with `timeout_ms`, measuring wall-clock latency around each call, and writing:

- `bench/results/<runId>/games.jsonl` — line 1 is a header `{ run_id, protocol, suite, table, seeds, agents: [{seat, spec, name}], started_at }`; then one line per decision `{ game_id, seed, rotation, round, turn, player, agent, observation, raw_response, action, legal, invalid_reason, fallback_used, latency_ms, prompt_version, prompt_hash }`; then one `{ game_id, final_scores, winner, rounds }` per game; and a footer with the metrics summary.
- `bench/results/<runId>/summary.json` — the metrics.

Games in a run are played sequentially in v1. An adapter that crashes or disconnects fails the run with a clear message rather than being scored as timeouts.

### 6.4 Metrics

`bench/metrics.js` computes, for the agent under test and for every other seat:

| Metric | Definition |
| --- | --- |
| `win_rate` | games won ÷ games, Wilson 95 % interval; a tie for first counts as a win for each tied player |
| `mean_score_per_round` | banked points per round played, mean ± 95 % CI |
| `points_vs_table` | agent's final score minus the mean of the other seats' final scores, per game, mean ± 95 % CI |
| `bust_rate` | rounds busted ÷ rounds played |
| `flip7_rate` | rounds with Flip 7 ÷ rounds played |
| `mean_hits_per_round` | hit decisions ÷ rounds |
| `rounds_per_game` | mean |
| `invalid_rate` | invalid replies ÷ decisions |
| `timeout_rate` | timeouts ÷ decisions |
| `fallback_count` | decisions where the default action was applied |
| `latency_ms` | mean, p50, p95 |

Win rate and points are reported separately because published simulations show aggressive policies can win more games with fewer mean points. `points_vs_table` is the headline luck-adjusted skill number; `win_rate` is the headline outcome.

### 6.5 Rating

`node bench/rate.js bench/results/*` reads every game footer across the given runs, keeps games where every seat is a named agent (`--agents` runs and bot-only runs), and computes TrueSkill (via `ts-trueskill`, defaults μ=25, σ=25/3) with each game as a free-for-all ranked by final score, ties shared. It prints a table of `name, mu, sigma, conservative = mu − 3σ, games` and writes `ratings.json`. Baseline bots are named agents, so any external agent's rating is anchored to them.

### 6.6 Reproducibility

- The seed fully determines every shuffle, including mid-round reshuffles. The log records the seed, protocol id, and every action, so `bench/replay.js <games.jsonl>` reconstructs each game and asserts every logged observation is byte-equal to the recomputed one.
- Model nondeterminism is not solvable here; the answer is many games and confidence intervals, which the metrics carry.

## 7. Error handling

- Illegal or stale `act` messages from the browser get an `error` reply and no state change.
- Engine `IllegalAction` in a live room is caught per message and never crashes the room. In the runner it cannot occur, because the runner validates against `legal_actions` before stepping.
- Every timer callback runs in its own try/catch and logs. Process-level `uncaughtException` and `unhandledRejection` handlers log and continue.
- `ws` `maxPayload` is set and `ws.on("error")` is handled, so oversized frames close with 1009 instead of crashing.
- Subprocess agents that exit unexpectedly, and HTTP agents that refuse connections, abort the run with the agent's stderr or the connection error in the message.
- The app shell is read once at startup; restart the server after editing `index.html` (known trap from emoji and follow-suit).

## 8. Testing

All under `node --test`, with fake clocks injected; no test sleeps.

- `tests/cards.test.js` — deck is 94 with the exact composition; scoring table of §2.4 asserted exactly.
- `tests/engine.test.js` — one test per rule and ruling in §2, driven by seeds chosen so the deck order produces the situation (helper `findSeed(predicate)` searches seeds and records the found seed literally in the test): bust, Second Chance save and turn end, Second Chance give-away and discard, Freeze including during the deal and on an undealt player, Flip Three with early stop on bust, on Flip 7, with set-aside Freeze and Flip Three resolved after, with set-aside cards discarded on bust, Flip 7 ends the round mid Flip Three, only-active-player must self-target, turn order after action cards, reshuffle when the deck empties, deck-exhausted skip, tie at 200 plays another round, dealer rotation. Determinism: the same seed and actions produce identical state and events; different seeds produce different deals.
- `tests/view.test.js` — observation never contains `deck` order or `rngState` in any phase (forbidden keys); required keys present; `legal_actions` matches `legalActions(state)` for the pending player and is empty for others; `round_score` matches §2.4.
- `tests/bots.test.js` — each bot returns a legal action for 1,000 random observations; targeting rule cases; mean round score over the `smoke` suite within the documented band per bot.
- `tests/defaults.test.js` — default action is always legal.
- `tests/adapters.test.js` — in-process, subprocess (fixture script under `tests/fixtures/`), and HTTP (fixture server on a spare port) adapters each play a `smoke` game; invalid reply then retry; second invalid reply falls back; timeout falls back; crash aborts with a message.
- `tests/bench.test.js` — running the `smoke` suite writes a valid `games.jsonl` and `summary.json`; every metric has the documented shape; `replay.js` passes on its own output; `rate.js` on two runs ranks a known-strong bot above `random`.
- `tests/render-text.test.js` — rendering is stable for a fixture observation (snapshot string), and the hash changes when the observation changes.
- `tests/rooms.test.js`, `tests/room-game.test.js` — seats, resume takeover, expiry, timer default action on expiry with the fake clock, bots acting, `onChange` called per step.
- `tests/server.test.js` — spawns the real server on a spare port with short timers: quick play, join, resume displaces the old socket with 4000 while it is still open, `act` round trip, stale `act` rejected, agent join sets the badge, oversized frame closes 1009, a full 2-player game ends with `game_over` and the scores equal the sum of round results.
- Manual pass in Chrome before calling it done: quick play through a whole game on desktop and phone width, play-with-friends with two browser profiles, a reload mid-game resumes the seat, `bench/live.js` seats an agent in a room and it plays.

## 9. Deployment

Render web service defined by `render.yaml` copied from follow-suit with the name `flip7`: free plan, `npm ci`, `npm start`, health check on `/health`, `NODE_VERSION=22`, auto-deploy from `main`. The free tier sleeps after idle and forgets rooms on wake; acceptable for launch. The benchmark never depends on the deployed server: it runs locally against the engine. `bench/live.js` can point at `wss://flip7.onrender.com` or a local server.

## 10. Decisions log

- **Pure reducer with RNG in state** instead of follow-suit's mutable game closure: the benchmark needs byte-exact replay from a seed, and facets' spec already chose this shape for the same reason.
- **One observation object for browser, bots, and agents** instead of a separate agent view: Flip 7 hides almost nothing, so a single secrecy boundary is enough and guarantees the benchmark cannot drift from the live game.
- **String action ids** (`hit`, `stay`, `target:p3`) instead of structured actions: the legal set is tiny, single-token agents can answer with the id, and validation is a set membership test.
- **Retry once, then a safe default, never forfeit**: forfeits distort the other seats in a multiplayer round-based game; instruction-following failures are reported as their own metric instead.
- **Seat rotation on fixed seeds** instead of independent random games: cancels deck luck at the cost of 4× games per seed, which is cheap for bots and fair for slow agents because the seed count can be lowered.
- **TrueSkill via `ts-trueskill`** instead of a hand-rolled Elo: multi-player free-for-all games need a rating that handles more than two players; a dependency used only by `bench/rate.js` is acceptable.
- **Bots consume observations, not state**: structural secrecy, as facets' spec put it, and it makes every bot a valid in-process agent for free.
- **No LLM agent in v1** (owner's call): the harness ships the text renderer and three adapter examples so wiring one up later is a small, separate task.
- **Agents join live rooms with the browser protocol** instead of a separate agent endpoint: one protocol, one set of server tests, and `bench/live.js` is a thin client.
- **Sequential games in the runner**: parallel games would only matter for slow HTTP agents, and they complicate latency measurement and logs; deferred to `IDEAS.md`.
- **Turn timer defaults to stay** rather than skipping the player: in Flip 7 staying is always legal on your turn and is the conservative choice a disconnected player would want.
- **Dropped from earlier drafts**: a separate agent auth token for live rooms (room codes already gate humans the same way), spectators, and a per-room configurable target score.
