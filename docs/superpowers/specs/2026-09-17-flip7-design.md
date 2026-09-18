# Flip 7 — design spec

**Date:** 2026-09-17
**Status:** approved 2026-09-17 (Codex-reviewed); amended 2026-09-18 after plan review (marked *amended* below)
**Scope:** v1 of a real-time multiplayer Flip 7 website plus an agent-playable harness and benchmark.

## 1. What this is

Flip 7 is a press-your-luck card game: on your turn you either **hit** (flip one more card) or **stay** (bank what is in front of you). Flip a number you already have and you bust for zero. Flip seven different numbers and you score a bonus and end the round for everyone. First to 200 wins.

This project is two things built on one rules engine:

1. **A website** at `C:\dev\flip7`, built like `follow-suit/`: Express 5 plus raw WebSockets, vanilla JS in the browser, no build step, deployed on Render. People play in real time in 4-letter rooms, alone against bots or with friends.
2. **An agent harness and benchmark.** The same engine runs headless. Any program that can read a JSON observation and answer with a JSON action can sit at the table, through one of three adapters (in-process function, subprocess over JSONL, HTTP URL). A runner plays seeded suites against baseline bots, logs every decision, and reports how good the agent is. Agents can also take a seat in a live room over the browser's own WebSocket protocol.

The engine, the game view an agent sees, and the game view the browser renders are the same object. There is no second rules implementation to drift.

Out of scope for v1: accounts, persistence of results, an LLM reference agent (the harness ships a stub and examples only), spectators, chat, custom domain, sound, native apps, rule variants, parallel games in the runner.

## 2. Game rules

Sources: the publisher FAQ (theop.games/pages/flip-7-faqs) and the Dized rules FAQ. Where sources are silent, §2.9 records the ruling this implementation makes. Every ruling below is normative for the engine.

### 2.1 The deck

94 cards.

| Kind | Cards | Count |
| --- | --- | --- |
| Number | one 0, one 1, two 2s, three 3s, … twelve 12s | 79 |
| Modifier | +2, +4, +6, +8, +10 (one each), ×2 (one) | 6 |
| Action | Freeze ×3, Flip Three ×3, Second Chance ×3 | 9 |

Card encoding, used everywhere (engine, wire, logs): numbers are integers `0`–`12`; modifiers are the strings `"+2"`, `"+4"`, `"+6"`, `"+8"`, `"+10"`, `"x2"`; actions are `"freeze"`, `"flip_three"`, `"second_chance"`. Cards of the same encoding are indistinguishable.

### 2.2 Players and seating

2 to 6 players. The physical game says 3+, but 2 works and quick play needs it. Seats are numbered 0..n−1; play proceeds to the next seat number, wrapping. The dealer for round 1 is seat 0. Benchmark tables default to 4 players.

**Definitions used throughout.** A player is **active** in a round until they bust, stay, or are frozen; a player who has not yet been dealt a card is active. The **drawer** of a card is the player whose flip revealed it. Each player's **line** is the cards in front of them: number cards, modifier cards, and at most one Second Chance.

### 2.3 Zones and the deck across rounds

There are exactly four zones: the **deck** (face down, order hidden), the **discard pile** (face up, public), each player's **line** (public), and nothing else. Every card is in exactly one zone at all times.

- The deck is shuffled once at game start. It persists across rounds. It is **not** reshuffled at the start of a round.
- At the end of a round every line is moved to the discard pile, seat by seat in seat order, each line in the order numbers ascending, then modifiers, then Second Chance.
- When a card must be flipped and the deck is empty, the whole discard pile is shuffled with the engine RNG to form the new deck (`reshuffle` event). Lines are never reshuffled. If the deck is empty and the discard pile is empty **or holds only action cards** (*amended*: reshuffling only action cards would re-flip them forever), the flip is skipped (`deck_exhausted` event): a hit becomes a stay, a Flip Three ends early. This cannot happen with 94 cards and six players, but the engine must stay finite.
- An action card enters the discard pile **the moment it is flipped**, before it is resolved. What remains to be resolved is tracked in the resolution stack (§4.3), not by where the card sits. The one exception is Second Chance, which goes to the drawer's line if kept, to the recipient's line if given, and to the discard if neither.

Because of this, the cards not visible in any line or in the discard pile are exactly the cards in the deck. That identity is the normative "unseen cards" formula for bots and agents (§6.2).

### 2.4 A round

1. **Deal.** A deal cursor starts at the seat after the dealer and visits every seat once in seat order. Each seat visited receives exactly one flipped card into its line, unless that player is already frozen, in which case the cursor skips them and they receive no card. If the flipped card is an action card, dealing pauses, the card is resolved fully (§2.6, including any target decision), then the cursor continues. The round can end during the deal (Flip 7 from a deal-time Flip Three, or no active players remaining); if so, the remaining seats are not dealt.
2. **Turns.** Starting at the seat after the dealer and moving in seat order, each active player takes one turn: **hit** or **stay**. Hitting flips exactly one card into the line. If it is an action card, it is resolved fully. Either way the turn then ends and play moves to the next active seat after the seat whose turn it was. **Stay is always legal on your turn**, including with an empty line (a player whose only dealt card was an action card given away has an empty line and scores 0 if they stay).
3. **Bust.** A flipped number equal to a number already in that player's line is a bust unless that player holds a Second Chance (§2.6). A busted player's whole line goes to the discard pile immediately and they score 0 this round.
4. **Flip 7.** The moment a player has seven distinct numbers in their line, that player has flipped 7 and **the round ends immediately for everyone**: no further cards are flipped, any Flip Three in progress stops, any unresolved set-aside action cards are dropped (they are already in the discard). Modifier and action cards do not count toward the seven.
5. **Round end.** The round also ends when no active players remain. Round scores are then settled once (§2.5).

### 2.5 Round score and settlement

A player's **round score** at any moment is computed from their line, in this order:

1. Sum of number cards.
2. If ×2 is in the line, double that sum. ×2 doubles number cards only.
3. Add each + modifier.
4. Add 15 if the player has flipped 7.

At round end, **settlement** adds the round score to the banked total (`score`) of every player who did not bust, including frozen and stayed players. Freeze and Stay **lock** a line (no more cards can be added); they do not add to the total themselves, so nothing is ever credited twice. A busted player adds 0. A Second Chance card is worth nothing.

Worked examples, which tests assert exactly:

| Numbers | Modifiers | Flip 7 | Score |
| --- | --- | --- | --- |
| 3, 7, 12 | — | no | 22 |
| 3, 7, 12 | ×2 | no | 44 |
| 3, 7, 12 | ×2, +4 | no | 48 |
| 0, 1, 2, 3, 4, 5, 6 | +10 | yes | 46 |
| 0, 1, 2, 3, 4, 5, 6 | ×2, +10 | yes | 67 |
| (busted) | ×2, +10 | — | 0 |
| — (frozen with an empty line) | — | no | 0 |
| — (frozen before any number) | +4 | no | 4 |

### 2.6 Action cards

The drawer of an action card chooses its target. Legal targets are **active** players, including the drawer, except where stated. If the drawer is the only active player, they must target themselves. Choosing a target is a **decision** the engine asks for (§4.3), like hit-or-stay. Every action card is resolved fully, including its target decision, before play continues.

- **Freeze.** The target's line is locked and they are out for the round (`status: "frozen"`). Their round score is settled at round end like everyone else's. A Second Chance does not defend against Freeze. A Freeze may target a player who has not yet been dealt a card; that player's line stays empty and they score 0.
- **Flip Three.** The target flips the next three cards one at a time into their line. Each number and modifier is applied as it is flipped. The sequence stops early if the target busts or flips 7 (which ends the round). Action cards flipped during the three:
  - Second Chance: resolved immediately, exactly as below. If the target keeps it, it may save them later in the same sequence.
  - Freeze and Flip Three: **set aside**. The card is already in the discard; the resolution stack records it. After the third card, if the target is still active, the target chooses a target for each set-aside card in the order flipped, and each is resolved fully (a set-aside Flip Three can itself produce set-aside cards, which nest). If the target busted, or the round ended, the set-aside cards are dropped unresolved.
  - A Second Chance **used** during the three counts as one of the three flips (the duplicate is the card that was flipped) and the sequence continues.
  - A Flip Three does not give anyone an extra turn. Once it and everything nested in it have resolved, play continues from where it was interrupted: the next seat after the original drawer's turn, or the next deal-cursor seat.
- **Second Chance.** If the drawer's line holds no Second Chance, it goes into their line. Otherwise the drawer must give it to an active player whose line holds none (a decision); if there is no such player it is discarded. When a held Second Chance is **used** (a duplicate number is flipped), the duplicate number and the Second Chance both go to the discard pile and the player remains active. Outside a Flip Three that flip was the player's one card for the turn, so their turn ends as usual.

### 2.7 Game end

After settlement, if any player has 200 or more points and exactly one player has the highest total, the game is over and that player wins. If two or more players are tied for the highest total and that total is 200 or more, another round is played by everyone, repeating until a single leader exists. Otherwise the next round begins. **After every round that does not end the game, the dealer marker advances one seat**, including after tie-extension rounds. Every player is active again at the start of a round.

### 2.8 Public and private information

Flip 7 is almost fully public. Every line, the discard pile, the number of cards left in the deck, and the resolution stack are public. The only hidden information is the **order of the deck** and the engine RNG state; no player, bot, agent, or browser ever sees them, and no player-facing message carries the seed. This is enforced in one module, `lib/view.js` (§4.4).

### 2.9 Rulings where the rulebook is silent

- Deal-time Freeze may target any active player, dealt or not. The deal cursor skips frozen seats.
- Second Chance give-away is resolved immediately when flipped, even inside a Flip Three, and the drawer chooses the recipient.
- Set-aside Freeze and Flip Three cards are targeted by the player who flipped the three cards, not by the player who drew the original Flip Three.
- A Second Chance used inside a Flip Three consumes one of the three flips; the sequence continues.
- After any action card resolution, play resumes from the interrupted point: the seat after the original turn-taker, or the next deal-cursor seat.
- Dealer advances one seat after every non-final round.

## 3. Product surface

### 3.1 Routes

| Route | Serves |
| --- | --- |
| `GET /` | App shell (landing) |
| `GET /how-to-play` | App shell (rules view) |
| `GET /:code` (4 lowercase letters) | App shell (room) |
| `GET /api/new-room` | `{ ok, room }`, reserves the code for 60 s |
| `GET /ws?room=abcd` | WebSocket |
| `GET /agent-protocol` | `docs/agent-protocol.md` as `text/plain` |
| `GET /health` | `ok` |

### 3.2 Views

Single app shell, `<section class="view" hidden>` per view, toggled in-document as in follow-suit.

- **Landing.** Name field. **Quick play** (new room, you plus three bots, deals immediately). **Play with friends** (new room, join card with the code and a copy-link button). **Join** a code.
- **Lobby.** Seat list with names, bot and agent badges, connection dots. Any seated player may add or remove a bot, and start with 2 to 6 seats. Target score fixed at 200.
- **Table.** Each player as a row: name, banked total, status badge (active / stayed / busted / frozen), number cards in ascending order, modifiers, a Second Chance token, and their current round score. Dealer marker. Deck count and the top of the discard pile. Whose decision it is and a countdown. For you, when it is your decision: **Hit** and **Stay** buttons, or a target picker listing legal targets with their scores. A collapsible event log. Card flips animate with a short CSS transition; `prefers-reduced-motion` disables it.
- **Round summary.** Overlay between rounds: what each player banked, the running totals, and a **Next round** button any seated player may press (auto-advances after 8 s).
- **Results.** Final standings, winner, **Play again** (back to lobby with the same seats).
- **How to play.** The rules of §2 in plain language.

### 3.3 Bots in live rooms

Server-side bots occupy seats like players (`isBot: true`). They use the same policies as the benchmark baselines (§6.2), chosen at random from `threshold25`, `bustRisk25`, `adaptive` with a random name. Bots act after a jittered delay of 700 to 1500 ms so the table is readable.

### 3.4 Agents in live rooms

An agent joins a room as a WebSocket client using the same protocol as the browser (§4.6). `bench/live.js` does this for any adapter: it connects, joins with a name and `agent: true`, waits in the lobby, and answers every decision the room asks of its seat, at most once per `turnNumber`. Agents get the same turn timer as humans. The room shows an "agent" badge on the seat. **A connected agent counts as an occupant** for room lifetime (§4.5). No authentication beyond knowing the room code, which is how humans join too.

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
    view.js                 # observeGame(state, playerId): the secrecy boundary
    request.js              # makeRequest(gameView, context): the agent envelope
    defaults.js             # default action when a player fails or times out
    render-text.js          # request -> versioned text rendering for LLM agents
    bots.js                 # baseline policies as agents: act(request) -> action
    rooms.js                # room registry, seats, resume tokens, expiry
    room-game.js            # engine + timers + bot/agent driving for one room
    snapshot.js             # room state message for one recipient
  agents/
    adapter.js              # resolveAgent(spec) -> adapter
    adapters/in-process.js  # module exporting { name, version, act }
    adapters/subprocess.js  # JSONL over stdin/stdout
    adapters/http.js        # POST /move
    examples/threshold.js   # in-process example
    examples/http-server.js # Node HTTP example
    examples/subprocess.py  # Python stdlib example (subprocess adapter)
  bench/
    suite.js                # suite definitions: seeds, table size, rotations
    run.js                  # play a suite, write games.jsonl + summary.json
    metrics.js              # aggregate into metrics with seed-block bootstrap CIs
    rate.js                 # TrueSkill over results directories
    replay.js               # re-run a game log through the engine, verify byte-equal
    live.js                 # drive an adapter as a seat in a live room
    fixtures/calibration.json  # committed bot calibration values (§8)
  public/
    index.html  styles.css
    js/{app,net,landing,lobby,table,results,log}.js
  tests/
    fixtures/               # agent scripts and servers used by adapter tests
    helpers/{clock.js,deck.js}
  docs/superpowers/specs/   docs/superpowers/plans/
  docs/agent-protocol.md    # the document third parties read
  render.yaml  AGENTS.md  CLAUDE.md  LEARNINGS.md  IDEAS.md
```

### 4.2 Authority and determinism

The server is authoritative in live rooms; the runner is authoritative in benchmarks. Both drive the same `lib/engine.js`.

The engine is a pure reducer: `step(state, input) -> { state, events }` with no I/O and no clock. All randomness comes from a seeded PRNG whose state lives inside `state`; nothing else consumes it. Bots and the runner use their own separately seeded RNG, so a policy's random choices can never perturb the deck. Given a seed and the sequence of player actions, every game replays identically, byte for byte. `bench/replay.js` proves it for every logged game and fails on any divergence.

### 4.3 Engine

```js
createGame({ players: [{ id, name }], seed, targetScore = 200, deck? }) -> state
step(state, input) -> { state, events }
legalActions(state) -> string[]        // for state.pending, [] if none
pendingPlayer(state) -> playerId | null
```

`deck` is a test-only option: an explicit card array used instead of the seeded shuffle for the initial deck (reshuffles still use the RNG). Tests build rule scenarios from known decks rather than searching for seeds.

Inputs:

- `{ type: "start_round" }` — legal in `lobby` and `round_over`. Deals and plays forward until a decision is needed or the round ends.
- `{ type: "act", player, action }` — `action` must be one of `legalActions(state)` and `player` must be `pendingPlayer(state)`. Anything else throws `IllegalAction`; the caller decides what to do about it.

Actions are strings so single-token agents can answer with just the id: `"hit"`, `"stay"`, `"target:<playerId>"`.

State shape (all fields required, no `undefined`):

```js
{
  seed, rngState, targetScore,
  players: [{ id, name, seat, score }],     // score = banked total
  dealerSeat, roundNumber, turnNumber,      // turnNumber increments per decision asked
  phase: "lobby" | "round" | "round_over" | "game_over",
  deck: [card...],                          // NEVER leaves lib/view.js
  discard: [card...],                       // public, in discard order
  round: {
    lines: { [id]: { numbers: [], modifiers: [], secondChance: bool,
                     status: "active" | "stayed" | "busted" | "frozen" } },
    dealCursor: null | { nextSeat, remaining },  // non-null only during the deal; remaining = seats still to visit (amended)
    turnSeat: null | seat,                  // the seat whose turn is in progress
    pending: null | { type: "hit_or_stay", player }
                  | { type: "choose_target", player, card, candidates: [id...] },
    resolution: [frame...],                 // stack, top last; empty when nothing resolving
    results: null | { [id]: { roundScore, flip7: bool } }
  },
  winner: null | id,
  history: [event...]                       // every event this game, in order
}
```

A resolution **frame** is one action card being resolved:

```js
{ card: "freeze" | "flip_three" | "second_chance",
  drawer: id,                               // who flipped it (chooses the target)
  target: null | id,
  remaining: 0..3,                          // flip_three only: cards still to flip
  setAside: [card...],                      // flip_three only: in flip order, not yet resolved
  ended: bool }                             // flip_three only: the three flips are done (amended)
```

Resolution algorithm: flipping an action card pushes a frame. The top frame drives the engine: if it has no target, `pending` becomes `choose_target` for the frame's drawer (or the frame is auto-targeted when only one candidate exists, including when the drawer is the only active player). A `flip_three` frame with a target flips cards while `remaining > 0`; an action card flipped during it either pushes a `second_chance` frame on top (resolved immediately) or is appended to `setAside`. When `remaining` reaches 0 the frame is marked `ended` and stays on the stack as a continuation (*amended*): if the target busted, its `setAside` list is cleared; otherwise each `setAside` card in order is shifted off and pushed as a new frame with `drawer = target`, resolved fully before the next is pushed, so the public stack never shows a later set-aside card as a frame. The continuation is popped when its `setAside` list is empty. If the round ended, the whole stack is cleared. When the stack is empty, play resumes from `dealCursor` if non-null, else from the seat after `turnSeat`. This represents any depth of nesting.

Events (each `{ type, ...fields, turnNumber }`): `round_started {roundNumber, dealer}`, `dealt {player, card}`, `hit {player, card}`, `stay {player}`, `bust {player, card}`, `second_chance_saved {player, card}`, `second_chance_kept {player}`, `second_chance_given {from, to}`, `second_chance_discarded {player}`, `freeze {from, to}`, `flip_three_started {from, to}`, `flip_three_card {player, card}`, `flip_three_ended {player}`, `set_aside {player, card}`, `flip7 {player}`, `reshuffle {count}`, `deck_exhausted {player}`, `round_ended {results}`, `game_over {winner, scores}`. The field is `turnNumber` everywhere: engine history, observation history, and logs.

The engine advances automatically through everything that is not a decision: it deals, flips Flip Three cards, applies busts and freezes, ends rounds, and only stops when `pending` is set or the phase is `round_over` / `game_over`. Callers never step through card flips one at a time.

### 4.4 The game view (`lib/view.js`) and the request envelope (`lib/request.js`)

`observeGame(state, playerId) -> gameView` is the only function that turns engine state into something a player, bot, agent, or browser may see. It is the secrecy boundary: it never copies `deck`, `rngState`, or `seed`, and a test asserts those keys are absent in every phase. It is pure and deterministic: it contains only game-visible data (§5.2 `game`).

`makeRequest(gameView, context)` wraps the view with transport context (`protocol`, `game_id`, `timeout_ms`, `retry`, `request_id`) to produce the **request** an agent receives (§5.2). Rooms and the runner both call it; nothing about the transport lives in engine state.

Bots are structurally incapable of reading the deck: `lib/bots.js` receives requests, never state.

### 4.5 Rooms (`lib/rooms.js`, `lib/room-game.js`, `lib/snapshot.js`)

Copied from follow-suit's design, so only the differences are listed.

- Room code: 4 random lowercase letters, reserved 60 s by `/api/new-room`, room object created on first socket attach. Socket at `/ws?room=abcd`; the room is fixed for the socket's life.
- Seats: `{ id, name, isBot, isAgent, resumeToken, ws, connected, disconnectedAt }`. A resume token is minted on join and stored by the browser in `localStorage` under `flip7:token:<room>`. Resume adopts the seat unconditionally and closes the displaced socket with code 4000; clients never auto-reconnect on 4000 and reconnect with backoff (1 s × 1.5, capped at 5 s) on every other close, sending `resume` on open. An unknown resume token gets `error { code: "unknown_token" }` and the client falls back to the join card. Message and close handlers bail if `seat.ws !== ws`. Every message handler re-resolves its room from the registry first.
- No host. Any seated player may add or remove bots, start, advance a round, or return to the lobby.
- `room-game.js` wraps the engine for one room: it owns the timers, drives bots and default actions, and calls `onChange` after every engine step. It maps seat ids to engine player ids one to one. Engine player names are the seat names at start.
- **Timer discipline.** Every delayed callback in a room (turn timer, round-summary auto-advance, bot think delay) carries an **epoch** `{ gameId, roundNumber, turnNumber }` captured when armed, and re-checks the room's current epoch immediately before mutating anything; a mismatch is a no-op. Arming a new timer of a kind cancels the previous one of that kind. `gameId` is a per-room counter incremented on `start-game`.
- **Turn timer.** Armed whenever the engine sets `pending`. On expiry the room applies `defaultAction(request)` (§5.4) for that player and logs a `timeout` room event (not in engine history). Humans, agents, and bots all share `TURN_MS`; bots act well before it.
- **Disconnects.** A disconnected human keeps their seat for the whole game; their decisions fall to the timer. Seat expiry runs only in `lobby` and `game_over`. A room with no connected **occupant** (human or agent) for `RESUME_TTL_MS` is deleted in any phase. A room of only visitors is deleted when the last visitor leaves.
- Broadcast is a full per-recipient snapshot on every change, sent once per change (*amended*: the server suppresses its trailing broadcast when the room game already broadcast during the same message). No diffs.

### 4.6 Wire protocol

Client → server:

| type | fields | notes |
| --- | --- | --- |
| `resume` | `resumeToken` | adopt a seat |
| `join` | `name`, `resumeToken?`, `agent?: true` | seat or adopt; `agent` sets the badge and occupant status |
| `quick-play` | `name`, `resumeToken?` | seat; if the room was empty, add 3 bots and start |
| `add-bot` | — | seated, lobby only |
| `remove-bot` | `playerId` | seated, lobby only |
| `start-game` | — | seated, lobby, 2–6 seats |
| `act` | `turnNumber`, `action` | the decision for `turnNumber`; stale or illegal → `error` |
| `next-round` | `roundNumber` | seated, `round_over` only; stale → ignored |
| `return-to-lobby` | — | seated, `game_over` only |

Server → client:

| type | fields |
| --- | --- |
| `joined` | `playerId`, `resumeToken` |
| `state` | see below |
| `error` | `message`, `code?` (`game_in_progress`, `room_full`, `stale_turn`, `illegal_action`, `not_seated`, `unknown_token`, `not_enough_players` — *amended*: `start-game` with fewer than 2 seats after disconnected humans are dropped) |

`state` for a seated recipient:

```js
{ type: "state", room, phase, you: playerId,
  seats: [{ id, name, isBot, isAgent, connected }],
  game: observeGame(state, you) | null,      // null in lobby
  timer: { turnNumber, remainingMs } | null,
  roundSummary: { ... } | null, results: { ... } | null }
```

`game` is the same view an agent receives inside its request (§5.2), including `decision` and `legal_actions` when it is this recipient's decision; `legal_actions` is `[]` otherwise. Visitors receive `{ type: "state", room, phase, you: null, playerCount, maxPlayers }`.

Never included for any recipient in any phase: the deck order, the engine RNG state, the seed, any other seat's resume token.

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
| `file:./path.js` | in-process | module exports `{ name, version, act(request) -> action \| Promise<action>, start?(info), end?(result) }` |
| `cmd:"python agent.py"` | subprocess | JSONL over stdin/stdout, one JSON object per line |
| `http://host:port` | HTTP | `POST /move` with the request, JSON reply |

**Identity.** Every agent has a `name` and a `version` string; in-process modules export them, HTTP agents return them from `GET /`, subprocess agents include them in their reply to `start`. Logs and ratings key on `name@version`.

**Lifecycle**, identical across adapters:

| Hook | When | Payload | Deadline | On failure |
| --- | --- | --- | --- | --- |
| `hello` | once per run | — | 10 s | run aborts |
| `start` | once per game | `{ type: "start", protocol, game_id, you, players: [{id, name, seat}] }` | 10 s | run aborts |
| `move` | once per decision (plus one retry) | `{ type: "move", request_id, request }` | `timeout_ms` | §5.4 |
| `end` | once per game | `{ type: "end", game_id, result: { final_scores, winner, rounds } }` | 10 s | logged, ignored |
| `shutdown` | once per run | — | 2 s | forced |

- **In-process:** `hello` loads the module; `start`/`end` call the optional hooks; `shutdown` is a no-op. A promise still pending after its deadline is ignored when it settles.
- **Subprocess:** one process per run, spawned at `hello`. Runner → agent lines are the payloads above; the agent answers `hello` with `{"name","version","protocol"}` and each `move` with `{"request_id","action"}`; it may answer `start`/`end` with anything or nothing. Replies are matched by `request_id`; a reply with an unknown or already-settled `request_id` is logged and discarded, so a late answer can never be consumed by the next move. A line with no `request_id` at all (non-JSON, or JSON without the field) is attributed to the single pending request when exactly one is pending and judged invalid, and discarded otherwise (*amended*; always echo `request_id`). Stdout lines over 64 KB are an invalid reply. Stderr is captured into the log, capped at 1 MB per run. `shutdown` closes stdin, waits 2 s, then kills. If the process exits during a run, the run aborts with its exit code and last stderr.
- **HTTP:** `hello` is `GET /` → `{ "name", "version", "protocol" }` (a protocol mismatch aborts the run). `start` and `end` are `POST /start` and `POST /end` with the payload as the body; replies are ignored. `move` is `POST /move` with `{ "request_id", "request" }`; the reply must be status 200 with JSON `{ "action" }` (`request_id` optional), at most 64 KB. Any other status, a non-JSON body, or a connection error is an invalid reply. A reply after the deadline is a timeout and the connection is dropped.

The request and action are byte-identical across all three adapters.

### 5.2 Request and game view

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

- `game_id` is an opaque random id. It does not encode the seed, suite index, or rotation; the mapping lives only in the runner's private log header.
- `decision` is `{ "type": "hit_or_stay" }` or `{ "type": "choose_target", "card": "freeze", "candidates": ["p1", "p3"] }`. In the latter case `legal_actions` is `["target:p1", "target:p3"]`.
- `round_score` is §2.5 applied to the line now.
- `discard` is every card in the discard pile in the order discarded. `resolution` is the public resolution stack (§4.3 frames, with `remaining` and `setAside`). Cards in the deck are exactly the 94 minus every line minus `discard` (§2.3).
- `history` is the last 40 engine events of this round; the runner's log has all of them.
- `retry` is `null` or `{ "attempt": 2, "reason": "illegal action \"hitt\"; legal: hit, stay", "previous": "<raw previous reply>" }` on the one retry (§5.4).

`lib/render-text.js` renders a request as text for LLM prompts. The template is versioned (`prompt/v1`); the version and a hash of the rendered text are logged with each attempt so results can be attributed to prompt changes. Nothing in v1 calls an LLM; this exists so third-party LLM agents start from a common prompt.

### 5.3 Action

`{ "action": "hit" }`, `{ "action": "stay" }`, or `{ "action": "target:p3" }`. Optional `"reasoning": "<string>"` (capped at 8 KB) is stored in the log and otherwise ignored. In-process agents may return the bare string.

### 5.4 Invalid moves and timeouts

Each `move` is an **attempt**. An attempt's outcome is one of `ok`, `invalid` (not JSON, no `action`, or an action not in `legal_actions`), or `timeout` (no valid reply within `timeout_ms`, uniformly across adapters).

1. On a first `invalid` attempt the agent is asked once more with `retry` populated and a fresh `request_id`. A `timeout` is never retried.
2. If the second attempt is not `ok`, or the first was a `timeout`, the runner applies `defaultAction(request)` from `lib/defaults.js`: `stay` for hit-or-stay; for target choices, the bots' targeting rule (§6.2). The game continues. Nobody forfeits, because a forfeit in a four-player round-based game distorts every other seat's result.
3. Every attempt is logged with its outcome; `fallback_used` marks the decision.

Live rooms use the same outcomes with `TURN_MS` as the deadline and no retry, because a human is waiting.

## 6. Benchmark

### 6.1 Suites

A suite is a table size, a list of seeds, and the rotations to play. `bench/suite.js` defines:

- `standard`: table of 4, 50 seeds, `seed_i = fnv1a("standard:" + i)`, 4 rotations each → 200 games. Public and fixed, for development and regression.
- `fresh`: same shape, seeds derived from `--seed-base <string>` (default: the current timestamp, printed in the summary). Use it for results you intend to compare between agents you did not write; a fixed public suite can be memorised.
- `smoke`: table of 4, 3 seeds, 4 rotations; used by tests.

**Rotation** `r` seats the agent under test at seat `r` and the opponents, in `--opponents` order, at the remaining seats in seat order. The dealer for round 1 is always seat 0. Every rotation of a seed starts from the identical initial shuffle, because the engine shuffles from the seed and seat labels do not touch the RNG. Rotation balances **seat position** (who is dealt and acts first); it does not replicate the whole card path, since different decisions consume different cards and later reshuffles diverge. The four rotations of a seed are correlated and are treated as one block in every statistic (§6.4).

### 6.2 Baseline bots

All in `lib/bots.js`, all pure functions of the request plus an injected RNG (only `random` uses it). Each is an in-process agent (`name@version`, version `"1"`) and is also what live rooms use.

| Name | Hit-or-stay policy |
| --- | --- |
| `random` | uniform over `legal_actions` |
| `threshold25` | hit while `round_score < 25` |
| `bustRisk25` | hit while (unseen copies of held numbers ÷ unseen cards) < 0.25; a held Second Chance makes the risk 0 |
| `evOneStep` | hit iff the expected round score after one more card, from unseen-card counts, exceeds the current round score |
| `adaptive` | `bustRisk` with threshold `0.25 + 0.002 × (leader_score − my_score)`, clamped to [0.10, 0.45]; stays as soon as banking would put it at 200 or more while leading |

Unseen cards = deck composition minus `discard` minus every player's line (§2.3). This is public information.

Shared **targeting** rule (`lib/bots.js`, also used by `lib/defaults.js`): Freeze → the candidate other than self with the highest `score + round_score`, else self. Flip Three → self if own `unique_count ≤ 2` and self is a candidate, else the candidate other than self with the highest `score + round_score`, else self. Second Chance give-away → the candidate with the lowest `score`.

### 6.3 Runner

```
node bench/run.js --agent http://localhost:8080 [--suite standard|fresh|smoke] [--seeds 50] [--table 4]
                  [--seed-base <string>] [--opponents threshold25,bustRisk25,adaptive]
                  [--timeout 30000] [--out bench/results]
node bench/run.js --agents file:./a.js,file:./b.js,bot:adaptive,bot:threshold25   # all seats named
```

`--agent` is the seat under test; the rest of the table is filled from `--opponents` in order. `--agents` names every seat for head-to-head runs and rotates all of them cyclically. The runner plays every game of the suite sequentially, calling adapters in the seat's turn with `timeout_ms`, and writes `bench/results/<runId>/`:

- `games.jsonl`, one JSON object per line, in this order:
  1. header `{ kind: "run", run_id, protocol, suite, table, seed_base, seeds: [...], agents: [{ name, version, spec }], started_at }` (private: contains seeds);
  2. per game, first `{ kind: "game_start", game_id, seed, rotation, seats: [{ id, name, seat, agent, spec }] }` (*amended*: replay needs the player ids and names);
  3. then one `{ kind: "decision", game_id, turnNumber, player, agent, request, attempts: [{ request_id, raw_response, outcome, invalid_reason, latency_ms, prompt_version, prompt_hash }], action, fallback_used, latency_ms }` per decision, where `request` is the first attempt's actual envelope and the outer `latency_ms` is end to end including retries;
  4. then `{ kind: "game_end", game_id, final_scores, winner, rounds, events: [every engine event of the game] }`;
  5. footer `{ kind: "summary", ...metrics }`.
- `summary.json` — the metrics (§6.4).

An adapter that aborts (§5.1) fails the run with a clear message; partial results are kept with `aborted: true` in the summary.

### 6.4 Metrics

`bench/metrics.js` computes, for the agent under test and for every other seat:

| Metric | Definition |
| --- | --- |
| `win_rate` | games won ÷ games; a tie for first counts as a win for each tied player |
| `points_vs_table` | agent's final score minus the mean of the other seats' final scores, per game |
| `mean_score_per_round` | banked points per round played |
| `bust_rate` | rounds busted ÷ rounds played |
| `flip7_rate` | rounds with Flip 7 ÷ rounds played |
| `mean_hits_per_round` | hit decisions ÷ rounds played |
| `rounds_per_game` | mean |
| `invalid_attempt_rate` | invalid attempts ÷ attempts |
| `decisions_with_fallback_rate` | decisions where the default action was applied ÷ decisions |
| `timeout_rate` | timeout attempts ÷ decisions |
| `latency_ms` | mean, p50, p95 of per-decision end-to-end latency |

**Uncertainty.** The unit of independence is the **seed block** (all rotations of one seed). Every rate and mean is first aggregated within each seed block, then a 95 % interval is computed by a percentile bootstrap over seed blocks (2,000 resamples, seeded, so the interval itself is reproducible). The summary reports `n_seeds` as the effective sample size alongside `n_games`. No Wilson or normal-approximation intervals are used.

Win rate and points are reported separately because published simulations show aggressive policies can win more games with fewer mean points. `points_vs_table` is the headline luck-adjusted skill number; `win_rate` is the headline outcome.

### 6.5 Rating

`node bench/rate.js bench/results/*` reads every `game_end` across the given runs, keeps games where every seat is a named agent (`--agents` runs and bot-only runs), deduplicates by `game_id`, orders games deterministically by `(run started_at, game_start order)`, and computes TrueSkill (via `ts-trueskill`, μ=25, σ=25/3, β=25/6, τ=25/300, draw probability 0.02) with each game as a free-for-all ranked by final score, ties sharing a rank. Identity is `name@version`. It prints `name, version, mu, sigma, conservative = mu − 3σ, games` and writes `ratings.json`. It warns if any agent is not connected to at least one baseline bot through played games, because a disconnected rating is not comparable. TrueSkill's σ treats rotations as independent and is therefore optimistic; the seed-block bootstrap in `summary.json` is the honest uncertainty for a single agent.

### 6.6 Reproducibility

- The seed fully determines every shuffle, including reshuffles. The log records the seed (privately), the protocol id, every action, and every engine event, so `bench/replay.js <games.jsonl>` reconstructs each game and asserts that the recomputed event list and every recomputed game view are byte-equal to the logged ones.
- Model nondeterminism is not solvable here; the answer is many seeds and the bootstrap intervals.

## 7. Error handling

- Illegal or stale `act` and `next-round` messages from the browser get an `error` reply (or are ignored, per §4.6) and no state change.
- Engine `IllegalAction` in a live room is caught per message and never crashes the room. In the runner it cannot occur, because the runner validates against `legal_actions` before stepping.
- Every timer callback runs in its own try/catch and logs. A process-level `uncaughtException` or `unhandledRejection` logs, stops accepting connections, closes every socket with code 1012, and exits non-zero so Render restarts a clean process; in-memory rooms are lost, which the free-tier sleep already implies.
- `ws` `maxPayload` is set and `ws.on("error")` is handled, so oversized frames close with 1009 instead of crashing.
- Adapter failures abort the run with the agent's stderr, exit code, or connection error in the message (§5.1).
- The app shell is read once at startup; restart the server after editing `index.html` (known trap from emoji and follow-suit).

## 8. Testing

All under `node --test`, with fake clocks injected; no test sleeps. Rule tests build scenarios with `tests/helpers/deck.js`, which composes an explicit deck order for `createGame({ deck })`, so each test reads as a trace rather than a seed hunt.

- `tests/cards.test.js` — deck is 94 with the exact composition; scoring table of §2.5 asserted exactly.
- `tests/engine.test.js` — one trace per rule and ruling in §2: bust; Second Chance save keeps the player active and ends the turn; give-away and discard-when-everyone-has-one; Freeze during the deal on an undealt player, and the deal cursor skipping a frozen seat; a drawer who gives away their only dealt card has an empty line and may stay for 0; Flip Three stopping on bust; Flip Three completing Flip 7 mid-sequence ends the round and drops set-asides; Second Chance flipped and then used inside the same Flip Three, consuming one of the three; set-aside Freeze and Flip Three resolved after the three in flip order; a set-aside Freeze that freezes its own chooser before a later set-aside is resolved; a set-aside Flip Three nesting a further set-aside (two frames deep); the round ending during the initial deal; only-active-player auto-targets self; play resuming at the seat after the interrupted turn and at the deal cursor; deck persists across rounds and lines are discarded at round end in the specified order; reshuffle when the deck empties mid-round and mid Flip Three; deck-exhausted skip; tie at 200 plays another round and the dealer still advances; game over with a single leader. Determinism: the same seed and actions produce identical state and events; different seeds produce different deals.
- `tests/view.test.js` — game view never contains `deck`, `rngState`, or `seed` in any phase (forbidden keys); required keys present; `legal_actions` matches `legalActions(state)` for the pending player and is empty for others; `round_score` matches §2.5; unseen-card identity of §2.3 holds at every step of a seeded game.
- `tests/bots.test.js` — each bot returns a legal action for 1,000 random requests; targeting rule cases. Calibration is a **regression** check, not a correctness proof: `bench/fixtures/calibration.json` holds each bot's `mean_score_per_round` and `bust_rate` over a committed 200-seed bot-only run; the test replays the `smoke` suite and asserts exact equality with the smoke values stored in the same fixture (deterministic), and a separate `npm run calibrate` regenerates the fixture when a rules or policy change is intended.
- `tests/defaults.test.js` — default action is always legal.
- `tests/adapters.test.js` — in-process, subprocess (fixture script under `tests/fixtures/`), and HTTP (fixture server on a spare port) adapters each play a `smoke` game; invalid reply then retry; second invalid reply falls back; timeout falls back and a late reply with the old `request_id` is discarded; `hello` protocol mismatch aborts; subprocess exit aborts with stderr; shutdown kills a hung subprocess.
- `tests/bench.test.js` — running the `smoke` suite writes a valid `games.jsonl` and `summary.json` with every record kind in order; every metric has the documented shape and `n_seeds = 3`; `replay.js` passes on its own output; `rate.js` on two runs ranks `threshold25` above `random`, deduplicates a run passed twice, and warns on a disconnected agent.
- `tests/render-text.test.js` — rendering is stable for a fixture request (snapshot string), and the hash changes when the request changes.
- `tests/rooms.test.js`, `tests/room-game.test.js` — seats, resume takeover, unknown token, expiry, occupant rule counts agents, turn-timer default action on expiry, stale timer epochs are no-ops (turn, round summary, bot delay), bots acting, `onChange` called per step.
- `tests/server.test.js` — spawns the real server on a spare port with short timers: quick play, join, resume displaces the old socket with 4000 while it is still open, `act` round trip, stale `act` rejected, stale `next-round` ignored, agent join sets the badge and keeps the room alive past the TTL with no humans, oversized frame closes 1009, a full 2-player game ends with `game_over` and the scores equal the sum of round results.
- Manual pass in Chrome before calling it done: quick play through a whole game on desktop and phone width, play-with-friends with two browser profiles, a reload mid-game resumes the seat, `bench/live.js` seats an agent in a room and it plays.

## 9. Deployment

Render web service defined by `render.yaml` copied from follow-suit with the name `flip7`: free plan, `npm ci`, `npm start`, health check on `/health`, `NODE_VERSION=22`, auto-deploy from `main`. The free tier sleeps after idle and forgets rooms on wake; acceptable for launch. The benchmark never depends on the deployed server: it runs locally against the engine. `bench/live.js` can point at `wss://flip7.onrender.com` or a local server.

## 10. Decisions log

- **Pure reducer with RNG in state** instead of follow-suit's mutable game closure: the benchmark needs byte-exact replay from a seed, and facets' spec already chose this shape for the same reason.
- **Resolution stack** instead of a single Flip Three record: the official FAQ allows a Flip Three inside a Flip Three, so nesting is reachable and a stack is the only representation that does not lose context.
- **Action cards discard on flip**: makes "cards not visible are in the deck" exactly true at every moment, so bots and agents share one correct unseen-card formula.
- **Deck persists across rounds**: this is the physical game's rule (reshuffle only on exhaustion); a per-round reshuffle would change the odds and was an ambiguity in the first draft.
- **One game view for browser, bots, and agents**, wrapped in a transport envelope: Flip 7 hides almost nothing, so a single secrecy boundary is enough, and the envelope keeps protocol fields out of the engine.
- **No seed in any player-facing message**: the first draft leaked it in the observation, which would have let an agent reconstruct the deck.
- **String action ids** (`hit`, `stay`, `target:p3`) instead of structured actions: the legal set is tiny, single-token agents can answer with the id, and validation is a set membership test.
- **Retry once, then a safe default, never forfeit**: forfeits distort the other seats in a multiplayer round-based game; instruction-following failures are reported as their own metrics instead.
- **Seat rotation on fixed seeds, scored as seed blocks**: rotation balances seat position cheaply; treating the four rotations as one block keeps the intervals honest. A `fresh` suite exists because a fixed public suite can be memorised.
- **TrueSkill via `ts-trueskill`** instead of a hand-rolled Elo: free-for-all games need a multi-player rating; the dependency is confined to `bench/rate.js`, and its optimistic σ is stated rather than hidden.
- **Bots consume requests, not state**: structural secrecy, as facets' spec put it, and it makes every bot a valid in-process agent for free.
- **No LLM agent in v1** (owner's call): the harness ships the text renderer and three adapter examples so wiring one up later is a small, separate task.
- **Agents join live rooms with the browser protocol** and count as occupants: one protocol, one set of server tests, `bench/live.js` is a thin client, and an agent-versus-bots room does not vanish under a live agent.
- **Explicit test decks** instead of seed hunting: rule traces stay readable and survive PRNG changes.
- **Crash means restart**, not continue: after an uncaught exception room invariants may be broken; Render restarts the process in seconds.
- **Sequential games in the runner**: parallel games would only matter for slow HTTP agents and complicate latency measurement; deferred to `IDEAS.md`.
- **Turn timer defaults to stay**: in Flip 7 staying is always legal on your turn and is the conservative choice a disconnected player would want.
- **Dropped from earlier drafts**: a separate agent auth token for live rooms (room codes already gate humans the same way), spectators, a per-room configurable target score, Wilson intervals over games.
- **Amendments of 2026-09-18** (from the Codex review of the implementation plan, whose code was executed end to end before adoption): the game view carries `phase`, `current_player`, `results`, `winner` because the browser renders from it; set-aside cards become frames one at a time via an `ended` continuation so the public stack is honest; an action-only discard pile is not reshuffled; `game_start.seats` carries ids and names for replay; id-less subprocess replies count as invalid attempts for the sole pending request.
