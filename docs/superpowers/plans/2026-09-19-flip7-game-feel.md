# Flip 7 Game Feel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Flip 7 browser client show every consequential card before its consequence (bust, Flip Three, Second Chance) through a client-side presentation queue, and redesign the table as a felt card table with real motion.

**Architecture:** The server view gains a monotonic `history_start` cursor so the client can diff exactly which events it has not yet shown. A pure planner (`sequence.js`) turns new events into timed steps; a presenter (`present.js`) runs them through injected DOM effects (`effects.js`) and reconciles to the authoritative snapshot at a per-snapshot barrier; `table.js` becomes a keyed reconciler. CSS carries the new art direction.

**Tech Stack:** Node 22 (`node --test`, CommonJS tests plus ESM `.mjs` tests for client modules), Express 5, `ws`, vanilla ES modules, CSS only (no build step), one Google Font (Barlow Condensed).

**Spec:** `docs/superpowers/specs/2026-09-19-flip7-game-feel-design.md`

## Global Constraints

- No new npm dependencies, no build step, no framework. Client code is ES modules under `public/js/`.
- Engine (`lib/engine.js`), cards, rng, bots, defaults, request, render-text, `bench/`, `agents/` are never modified.
- Client modules that node tests import must have no top-level DOM access: `sequence.js` and `present.js` never touch `document` or `window`.
- Every timing number comes from the spec §3.2/§3.3: reveal `press-deck` 70, `travel` 240, `flip` 190, `rest` 220, `sort` 160; bust `pair` 500 + `shake` 280 + `hold` 550 + `sweep` 320; Flip Three per card `rest` 300 + `beat` 140; catch-up budget 2500 ms; barrier cap 4000 ms; catch-up minimums `flip` 120, `rest` 150, action `hold` 250, bust `pair`+`hold` 600, Second Chance pair 400, `sheet` 300, `results` 700.
- Bot delay defaults become `BOT_DELAY_MIN_MS: 1800`, `BOT_DELAY_MAX_MS: 2600`.
- Class names: playing cards are `.playing-card`, the round sheet is `.summary-sheet`; nothing uses a bare `.card` class.
- Tokens (spec §4.1) verbatim: `--rail #111917`, `--felt #071C1A`, `--felt-light #0D2A26`, `--surface #172421`, `--paper #F4E6C5`, `--ink #171914`, `--gold #F6B941`, `--cyan #50C7D9`, `--coral #F06A62`, `--danger #FF4D55`, `--success #55D68B`, `--text #F2EEE3`, `--muted #9AADA7`, `--edge #30443F`.
- `prefers-reduced-motion`: no travel, shake, sweep, score-roll, token-arc, scaling or rings; cards appear in place with a 120 ms colour emphasis; holds keep their duration.
- `public/index.html` is read once at server start; restart the server after editing it.
- Commit after every task with the attribution trailer used in this repo:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PjpwHarfCvJSHgvamad8AY
  ```
- Run `npm test` before each commit; it must stay green (102 tests at the base commit, more as tasks add them).

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `lib/view.js` | modify | add `history_start` |
| `lib/room-game.js` | modify | add `summaryInfo()` |
| `lib/snapshot.js` | modify | add `gameId`, `summaryTimer`, `roundSummary` on `game_over` |
| `lib/config.js` | modify | bot delay defaults |
| `docs/agent-protocol.md`, `README.md`, `docs/superpowers/specs/2026-09-17-flip7-design.md` | modify | document the fields and delays |
| `public/js/package.json` | create | `{"type":"module"}` so node imports the client modules |
| `public/js/sequence.js` | create | pure planner: `newEvents`, `cardKind`, `planSteps`, `compress`, `totalMs` |
| `public/js/present.js` | create | queue runner with injected effects and clock |
| `public/js/effects.js` | create | DOM effects for every step kind, reveal card flight, sheet, results |
| `public/js/table.js` | rewrite | keyed reconciler, countdown, controls, pending state |
| `public/js/app.js` | modify | route snapshots through the presenter; pending clears on reconnect/error |
| `public/js/lobby.js`, `landing.js`, `results.js`, `log.js` | modify | new markup hooks |
| `public/index.html` | rewrite | new shell markup |
| `public/styles.css` | rewrite | new art direction |
| `tests/sequence.test.mjs`, `tests/present.test.mjs` | create | planner and queue tests |
| `tests/view.test.js`, `tests/snapshot.test.js`, `tests/room-game.test.js`, `tests/config.test.js` | modify | server field tests |
| `docs/superpowers/reviews/2026-09-19-game-feel-codex-review.md` | create (Task 12) | Codex verdict |

---

### Task 1: Server additive fields and bot delays

**Files:**
- Modify: `lib/view.js`, `lib/room-game.js`, `lib/snapshot.js`, `lib/config.js`
- Modify: `tests/view.test.js`, `tests/snapshot.test.js`, `tests/room-game.test.js`, `tests/config.test.js`
- Modify: `docs/agent-protocol.md`, `README.md`, `docs/superpowers/specs/2026-09-17-flip7-design.md`

**Interfaces:**
- Produces: `observeGame(state, id).history_start` (number: absolute index into the game's full history of `history[0]`; equals the full history length when `history` is empty). `roomGame.timerInfo()` → `{ turnNumber, remainingMs, totalMs }` (`totalMs = config.TURN_MS`). `roomGame.summaryInfo()` → `{ remainingMs, totalMs }` (`totalMs = config.ROUND_SUMMARY_MS`) while the round-summary timer is armed, else `null`. Snapshot fields `gameId` (number or null), `summaryTimer`, `roundSummary` also populated when the game phase is `game_over`, and each `roundSummary.rows[i]` carries `status` (the player's line status: `active`, `stayed`, `frozen`, `busted`).

- [ ] **Step 1: Write the failing view test**

Append to `tests/view.test.js`:

```js
test("history_start is the absolute index of history[0] and stays consistent across rounds", () => {
  playSeeded(7, 400, (s) => {
    const v = observeGame(s, "p1");
    assert.equal(typeof v.history_start, "number");
    assert.equal(v.history_start + v.history.length, s.history.length, "window ends at the full history");
    v.history.forEach((e, i) => assert.deepEqual(e, s.history[v.history_start + i]));
    assert.ok(v.history.length <= 40);
  });
});

test("history_start is the history length before any round starts", () => {
  const v = observeGame(engine.createGame({ players: P3, seed: 3 }), "p1");
  assert.deepEqual(v.history, []);
  assert.equal(v.history_start, 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/view.test.js`
Expected: FAIL, `history_start` is `undefined`.

- [ ] **Step 3: Implement `history_start` in `lib/view.js`**

Replace the two lines that compute `start`/`roundEvents` and the `history:` entry so the function reads:

```js
  let start = -1;
  for (let i = s.history.length - 1; i >= 0; i--) if (s.history[i].type === "round_started") { start = i; break; }
  const roundEvents = start >= 0 ? s.history.slice(start) : [];
  const windowStart = start >= 0 ? start + Math.max(0, roundEvents.length - HISTORY_WINDOW) : s.history.length;
```

and in the returned object:

```js
    history_start: windowStart,
    history: roundEvents.slice(-HISTORY_WINDOW).map((e) => structuredClone(e)),
```

- [ ] **Step 4: Run the view tests**

Run: `node --test tests/view.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing room-game and snapshot tests**

Append to `tests/room-game.test.js`:

```js
test("summaryInfo reports the round-summary countdown and null otherwise", () => {
  const { g, clock } = setup();
  g.start(HUMANS);
  assert.equal(g.summaryInfo(), null);
  // stay twice: both lines stay, the round ends and the summary timer arms
  g.act(g.state.round.pending.player, g.state.turnNumber, "stay");
  g.act(g.state.round.pending.player, g.state.turnNumber, "stay");
  assert.equal(g.phase, "round_over");
  assert.deepEqual(g.summaryInfo(), { remainingMs: 500, totalMs: 500 });
  clock.advance(200);
  assert.deepEqual(g.summaryInfo(), { remainingMs: 300, totalMs: 500 });
  clock.advance(300);
  assert.equal(g.phase, "round");
  assert.equal(g.summaryInfo(), null);
  assert.deepEqual(g.timerInfo(), { turnNumber: g.state.turnNumber, remainingMs: 1000, totalMs: 1000 });
});
```

Also update the existing assertion in the first test of `tests/room-game.test.js` from `assert.deepEqual(g.timerInfo(), { turnNumber: 1, remainingMs: 1000 });` to `assert.deepEqual(g.timerInfo(), { turnNumber: 1, remainingMs: 1000, totalMs: 1000 });` (setup() uses `TURN_MS: 1000`). Search the tests directory for any other `deepEqual(g.timerInfo()` or `timerInfo(), {` and add `totalMs` there too.

Append to `tests/snapshot.test.js`:

```js
test("snapshot carries gameId, summaryTimer, and a roundSummary at game_over", () => {
  const { r, clock } = room();
  r.game = createRoomGame({ config: { ...readConfig({}), ROUND_SUMMARY_MS: 500 }, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, random: () => 0.5, seed: () => 1, onChange: () => {}, log: () => {} });
  r.game.start([...r.seats.values()]);
  r.phase = "playing";
  assert.equal(buildState(r, "s1").gameId, 1);
  assert.equal(buildState(r, "s1").summaryTimer, null);
  // force a round end by staying with both seats
  const g = r.game;
  g.act(g.state.round.pending.player, g.state.turnNumber, "stay");
  g.act(g.state.round.pending.player, g.state.turnNumber, "stay");
  const s = buildState(r, "s1");
  assert.equal(s.game.phase, "round_over");
  assert.deepEqual(s.summaryTimer, { remainingMs: 500, totalMs: 500 });
  assert.equal(s.roundSummary.round, 1);
  assert.deepEqual(s.roundSummary.rows.map((r) => r.status), ["stayed", "stayed"]);
  // a game_over state also carries the deciding round's summary
  g.state.players[0].score = 250; g.state.phase = "game_over"; g.state.winner = g.state.players[0].id;
  const over = buildState(r, "s1");
  assert.equal(over.game.phase, "game_over");
  assert.ok(over.roundSummary && over.roundSummary.rows.length === 2, "roundSummary present at game_over");
  assert.ok(over.results && over.results.winner === g.state.players[0].id);
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `node --test tests/room-game.test.js tests/snapshot.test.js`
Expected: FAIL (`summaryInfo is not a function`, `gameId` undefined).

- [ ] **Step 7: Implement `summaryInfo` and the snapshot fields**

In `lib/room-game.js`, change `timerInfo()` to return `{ turnNumber: state.turnNumber, remainingMs: Math.max(0, t.due - now()), totalMs: config.TURN_MS }` and after it add:

```js
    summaryInfo() {
      const t = timers.summary;
      if (!t || !state || state.phase !== "round_over") return null;
      return { remainingMs: Math.max(0, t.due - now()), totalMs: config.ROUND_SUMMARY_MS };
    },
```

In `lib/snapshot.js` replace the `roundSummary` condition and the return so they read:

```js
  if (game && (game.phase === "round_over" || game.phase === "game_over") && game.results) {
    roundSummary = { round: game.round, rows: game.players.map((p) => ({ id: p.id, name: p.name, status: p.status, roundScore: game.results[p.id].roundScore, flip7: game.results[p.id].flip7, score: p.score })) };
  }
  ...
  return { type: "state", room: room.code, phase: room.phase, you: recipientId, seats, game, gameId: g ? g.gameId : null, timer: g ? g.timerInfo() : null, summaryTimer: g ? g.summaryInfo() : null, roundSummary, results };
```

(The `results` block is unchanged.)

- [ ] **Step 8: Bot delays**

In `lib/config.js` set `BOT_DELAY_MIN_MS: 1800, BOT_DELAY_MAX_MS: 2600`. In `tests/config.test.js` update the expected object to `BOT_DELAY_MIN_MS: 1800, BOT_DELAY_MAX_MS: 2600`.

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: PASS, 106 tests (102 + 4 new).

- [ ] **Step 10: Docs**

In `docs/agent-protocol.md`, after the line `- \`game.history\` — the last 40 engine events of this round; the runner's log has all of them.` add:

```
- `game.history_start` — the absolute index, in the whole game's event list, of `history[0]` (the history length when `history` is empty). Monotonic across rounds; clients diff by `history_start + i` rather than by event content.
```

In `docs/superpowers/specs/2026-09-17-flip7-design.md` change `700 to 1500 ms` (§3.3) to `1800 to 2600 ms` and the config table row `700 / 1500` to `1800 / 2600`.

- [ ] **Step 11: Commit**

```bash
git add lib/view.js lib/room-game.js lib/snapshot.js lib/config.js tests/ docs/agent-protocol.md docs/superpowers/specs/2026-09-17-flip7-design.md
git commit -m "Add history_start cursor, summary timer, gameId to the view/snapshot; slow bots to 1.8-2.6 s"
```

---

### Task 2: `sequence.js` — history cursor diff and card kinds

**Files:**
- Create: `public/js/package.json`, `public/js/sequence.js`
- Test: `tests/sequence.test.mjs`

**Interfaces:**
- Produces: `newEvents(cursor, game)` → `{ events: Event[], reset: boolean, cursor: number }`; `cardKind(card)` → `"number" | "modifier" | "action"`.
- `game` is the `state.game` object from a snapshot: `{ history, history_start, turnNumber, players, ... }`.

- [ ] **Step 1: Create `public/js/package.json`**

```json
{ "type": "module" }
```

- [ ] **Step 2: Write the failing tests**

Create `tests/sequence.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { newEvents, cardKind } from "../public/js/sequence.js";

const ev = (type, fields = {}) => ({ type, turnNumber: 1, ...fields });
const game = (history, history_start, extra = {}) => ({ history, history_start, turnNumber: 1, players: [], ...extra });

test("newEvents: a null cursor resets and moves the cursor to the end of the window", () => {
  const r = newEvents(null, game([ev("round_started"), ev("dealt", { player: "a", card: 5 })], 0));
  assert.deepEqual(r, { events: [], reset: true, cursor: 2 });
});

test("newEvents: a cursor inside the window returns exactly the unseen tail", () => {
  const h = [ev("round_started"), ev("dealt", { player: "a", card: 5 }), ev("hit", { player: "a", card: 7 })];
  const r = newEvents(1, game(h, 0));
  assert.equal(r.reset, false);
  assert.deepEqual(r.events, h.slice(1));
  assert.equal(r.cursor, 3);
});

test("newEvents: a cursor at the end returns nothing (repeated snapshot)", () => {
  const h = [ev("round_started"), ev("dealt", { player: "a", card: 5 })];
  assert.deepEqual(newEvents(2, game(h, 0)), { events: [], reset: false, cursor: 2 });
});

test("newEvents: a window that slid past the cursor resets", () => {
  const h = Array.from({ length: 40 }, (_, i) => ev("hit", { player: "a", card: i }));
  const r = newEvents(3, game(h, 10));
  assert.deepEqual(r, { events: [], reset: true, cursor: 50 });
});

test("newEvents: a full 40-event window that slid by one returns exactly one event", () => {
  const h = Array.from({ length: 40 }, (_, i) => ev("hit", { player: "a", card: i + 1 }));
  const r = newEvents(40, game(h, 1));
  assert.equal(r.reset, false);
  assert.deepEqual(r.events, [h[39]]);
  assert.equal(r.cursor, 41);
});

test("newEvents: identical repeated events are not confused because indices, not content, are compared", () => {
  const h = [ev("flip_three_card", { player: "a", card: "freeze" }), ev("set_aside", { player: "a", card: "freeze" }), ev("flip_three_card", { player: "a", card: "freeze" }), ev("set_aside", { player: "a", card: "freeze" })];
  const r = newEvents(2, game(h, 0));
  assert.deepEqual(r.events, h.slice(2));
});

test("newEvents: a new round continues from the cursor without a reset", () => {
  // round 1 occupied absolute indices 0..4, round 2 starts at 5
  const h = [ev("round_started", { roundNumber: 2 }), ev("dealt", { player: "a", card: 2 })];
  const r = newEvents(5, game(h, 5));
  assert.deepEqual(r, { events: h, reset: false, cursor: 7 });
});

test("cardKind classifies numbers, modifiers, and actions", () => {
  assert.equal(cardKind(0), "number");
  assert.equal(cardKind(12), "number");
  assert.equal(cardKind("x2"), "modifier");
  assert.equal(cardKind("+10"), "modifier");
  for (const a of ["freeze", "flip_three", "second_chance"]) assert.equal(cardKind(a), "action");
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test tests/sequence.test.mjs`
Expected: FAIL, cannot find module `../public/js/sequence.js`.

- [ ] **Step 4: Implement**

Create `public/js/sequence.js`:

```js
// Pure planning for the presentation queue. No DOM here: node tests import
// this file directly. The spec is docs/superpowers/specs/2026-09-19-flip7-game-feel-design.md §3.

export const BUDGET_MS = 2500;       // target lag behind the server
export const BARRIER_CAP_MS = 4000;  // a decision never waits longer than this

// Which events in this snapshot has the client not presented? `cursor` is the
// absolute index of the next unseen event (null for a fresh presenter).
export function newEvents(cursor, game) {
  const history = game.history || [];
  const start = game.history_start || 0;
  const end = start + history.length;
  if (cursor === null || cursor === undefined || start > cursor) return { events: [], reset: true, cursor: end };
  if (cursor >= end) return { events: [], reset: false, cursor: end };
  return { events: history.slice(cursor - start), reset: false, cursor: end };
}

export function cardKind(card) {
  if (typeof card === "number") return "number";
  if (card === "x2" || (typeof card === "string" && card.startsWith("+"))) return "modifier";
  return "action";
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test tests/sequence.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add public/js/package.json public/js/sequence.js tests/sequence.test.mjs
git commit -m "Add sequence.js: history cursor diff and card kinds"
```

---

### Task 3: `sequence.js` — `planSteps`

**Files:**
- Modify: `public/js/sequence.js`
- Test: `tests/sequence.test.mjs`

**Interfaces:**
- Produces: `planSteps(events, game, opts)` → `Step[]`. `opts = { you, reducedMotion = false, nameOf = (id) => id }`. A step is `{ kind, tier, ms, min, player?, card?, from?, to?, caption?, turnNumber? }`. The last step is always `{ kind: "barrier", tier: "consequential", ms: 0, min: 0, turnNumber: game.turnNumber }`. Also exports `T` (the timing table) and `reveal` is internal.
- Tiers: `consequential` (must be seen; compress floors them at `min`), `structural` (compress zeroes them, except `sweep` → 120), `cosmetic` (compress drops them).

Step kinds produced (effects.js in Task 8/9 implements each): `press-deck`, `travel`, `flip`, `rest`, `sort`, `hold`, `to-discard`, `park`, `beat`, `pip-remove`, `pips-set`, `pips-clear`, `pair`, `shake`, `sweep`, `shield-flash`, `token-land`, `token-arc`, `freeze-sweep`, `banked-stamp`, `score-roll`, `notches`, `flip7-ring`, `reshuffle`, `caption`, `round-start`, `sheet`, `results`, `barrier`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/sequence.test.mjs` (add `planSteps` to the import):

```js
const kinds = (steps) => steps.map((s) => s.kind);
const names = { a: "Ann", b: "Bo" };
const opts = { you: "a", nameOf: (id) => names[id] || id };
const g1 = (turnNumber = 4) => game([], 0, { turnNumber });

test("planSteps: a number hit reveals, rests, sorts, then ends with a barrier carrying the turn number", () => {
  const steps = planSteps([ev("hit", { player: "a", card: 7 })], g1(4), opts);
  assert.deepEqual(kinds(steps), ["press-deck", "travel", "flip", "rest", "sort", "barrier"]);
  assert.deepEqual(steps.map((s) => s.ms), [70, 240, 190, 220, 160, 0]);
  assert.equal(steps.at(-1).turnNumber, 4);
  assert.equal(steps[2].tier, "consequential");
  assert.equal(steps[2].min, 120);
  assert.equal(steps[1].card, 7);
  assert.equal(steps[1].player, "a");
});

test("planSteps: a modifier hit adds a cosmetic score roll", () => {
  const steps = planSteps([ev("hit", { player: "a", card: "+4" })], g1(), opts);
  assert.deepEqual(kinds(steps), ["press-deck", "travel", "flip", "rest", "sort", "score-roll", "barrier"]);
  assert.equal(steps[5].tier, "cosmetic");
});

test("planSteps: an action hit holds at the hand then goes to discard before its consequence", () => {
  const steps = planSteps([ev("hit", { player: "a", card: "freeze" }), ev("freeze", { from: "a", to: "b" })], g1(), opts);
  assert.deepEqual(kinds(steps), ["press-deck", "travel", "flip", "hold", "to-discard", "freeze-sweep", "barrier"]);
  assert.equal(steps[3].ms, 450);
  assert.equal(steps[3].min, 250);
  assert.deepEqual([steps[5].from, steps[5].to], ["a", "b"]);
  assert.match(steps[5].caption, /Bo/);
});

test("planSteps: a dealt action card also follows the action path (a target decision may follow)", () => {
  const steps = planSteps([ev("dealt", { player: "b", card: "flip_three" })], g1(), opts);
  assert.deepEqual(kinds(steps), ["travel", "flip", "hold", "to-discard", "beat", "barrier"]);
  assert.equal(steps[4].ms, 110, "deal stagger");
});

test("planSteps: bust shows the duplicate pair, shakes, holds, then sweeps; no rest/sort for the busting card", () => {
  const steps = planSteps([ev("hit", { player: "a", card: 8 }), ev("bust", { player: "a", card: 8 })], g1(), opts);
  assert.deepEqual(kinds(steps), ["press-deck", "travel", "flip", "pair", "shake", "hold", "sweep", "barrier"]);
  const pair = steps[3], hold = steps[5], sweep = steps[6];
  assert.ok(kinds(steps).indexOf("pair") < kinds(steps).indexOf("sweep"), "the duplicate is shown before the line is cleared");
  assert.equal(pair.ms, 500); assert.equal(steps[4].ms, 280); assert.equal(hold.ms, 550); assert.equal(sweep.ms, 320);
  assert.equal(pair.min + hold.min, 600, "bust readability floor");
  assert.equal(pair.card, 8);
  assert.equal(pair.caption, "BUST · duplicate 8");
  assert.equal(sweep.min, 120);
});

test("planSteps: a Second Chance save shows the pair, flashes the shield, and discards both", () => {
  const steps = planSteps([ev("hit", { player: "a", card: 3 }), ev("second_chance_saved", { player: "a", card: 3 })], g1(), opts);
  assert.deepEqual(kinds(steps), ["press-deck", "travel", "flip", "pair", "shield-flash", "to-discard", "barrier"]);
  assert.equal(steps[3].ms, 400); assert.equal(steps[3].min, 400, "the Second Chance pair is never compressed below 400");
  assert.equal(steps[4].ms, 300); assert.equal(steps[4].min, 150);
  assert.equal(steps[3].caption, "SECOND CHANCE");
});

test("planSteps: a kept Second Chance lands as a token and is never sent to discard", () => {
  const steps = planSteps([ev("hit", { player: "a", card: "second_chance" }), ev("second_chance_kept", { player: "a" })], g1(), opts);
  assert.deepEqual(kinds(steps), ["press-deck", "travel", "flip", "hold", "to-token", "token-land", "barrier"]);
  assert.equal(steps[4].ms, 220);
});

test("planSteps: a second Second Chance goes to discard, then arcs to the receiver or is discarded", () => {
  const steps = planSteps([
    ev("hit", { player: "a", card: "second_chance" }), ev("second_chance_given", { from: "a", to: "b" }),
    ev("hit", { player: "a", card: "second_chance" }), ev("second_chance_discarded", { player: "a" }),
  ], g1(), opts);
  assert.deepEqual(kinds(steps), [
    "press-deck", "travel", "flip", "hold", "to-discard", "token-arc",
    "press-deck", "travel", "flip", "hold", "to-discard", "caption",
    "barrier",
  ]);
  assert.deepEqual([steps[5].from, steps[5].to], ["a", "b"]);
});

test("planSteps: Flip Three reveals three cards sequentially with a rest and a beat between each", () => {
  const steps = planSteps([
    ev("hit", { player: "a", card: "flip_three" }), ev("flip_three_started", { from: "a", to: "b" }),
    ev("flip_three_card", { player: "b", card: 2 }), ev("flip_three_card", { player: "b", card: 9 }), ev("flip_three_card", { player: "b", card: "+2" }),
    ev("flip_three_ended", { player: "b" }),
  ], g1(), opts);
  const k = kinds(steps);
  assert.deepEqual(k.slice(0, 6), ["press-deck", "travel", "flip", "hold", "to-discard", "pips-set"]);
  const per = ["press-deck", "travel", "flip", "rest", "sort", "beat", "pip-remove"];
  assert.deepEqual(k.slice(6, 13), per);
  assert.deepEqual(k.slice(13, 20), per);
  assert.deepEqual(k.slice(20, 28), ["press-deck", "travel", "flip", "rest", "sort", "score-roll", "beat", "pip-remove"]);
  assert.deepEqual(k.slice(28), ["pips-clear", "barrier"]);
  assert.equal(steps[9].kind, "rest"); assert.equal(steps[9].ms, 300, "Flip Three hold is 300");
  assert.equal(steps[11].ms, 140, "beat between Flip Three cards");
  assert.equal(k.filter((x) => x === "flip").length, 4, "three reveals plus the action card");
});

test("planSteps: an action drawn during Flip Three parks beside the discard, then resolves after flip_three_ended", () => {
  const steps = planSteps([
    ev("flip_three_card", { player: "b", card: "freeze" }), ev("set_aside", { player: "b", card: "freeze" }),
    ev("flip_three_card", { player: "b", card: 4 }),
    ev("flip_three_ended", { player: "b" }),
    ev("freeze", { from: "b", to: "a" }),
  ], g1(), opts);
  const k = kinds(steps);
  assert.deepEqual(k.slice(0, 6), ["press-deck", "travel", "flip", "hold", "park", "beat"]);
  assert.ok(k.indexOf("pips-clear") < k.indexOf("freeze-sweep"), "parked card resolves after the frame ends");
  assert.equal(k.filter((x) => x === "to-discard").length, 0, "the parked card is not sent to discard by the reveal");
});

test("planSteps: a Second Chance save inside Flip Three uses the same pair steps, then the Flip Three postlude", () => {
  const steps = planSteps([ev("flip_three_card", { player: "b", card: 5 }), ev("second_chance_saved", { player: "b", card: 5 })], g1(), opts);
  assert.deepEqual(kinds(steps), ["press-deck", "travel", "flip", "pair", "shield-flash", "to-discard", "beat", "pip-remove", "barrier"]);
});

test("planSteps: a bust inside Flip Three shows the pair and sweeps before the postlude and the frame end", () => {
  const steps = planSteps([ev("flip_three_card", { player: "b", card: 5 }), ev("bust", { player: "b", card: 5 }), ev("flip_three_ended", { player: "b" })], g1(), opts);
  assert.deepEqual(kinds(steps), ["press-deck", "travel", "flip", "pair", "shake", "hold", "sweep", "beat", "pip-remove", "pips-clear", "barrier"]);
});

test("planSteps: a dealt card that busts (a duplicate on the deal is impossible, but a dealt action still gets the deal beat after its consequence)", () => {
  const steps = planSteps([ev("dealt", { player: "a", card: "second_chance" }), ev("second_chance_kept", { player: "a" })], g1(), opts);
  assert.deepEqual(kinds(steps), ["travel", "flip", "hold", "to-token", "token-land", "beat", "barrier"]);
});

test("planSteps: deck exhausted then a forced stay captions the bank", () => {
  const steps = planSteps([ev("deck_exhausted", { player: "a" }), ev("stay", { player: "a" })], g1(), opts);
  assert.deepEqual(kinds(steps), ["caption", "banked-stamp", "barrier"]);
  assert.equal(steps[1].caption, "No cards left · banked");
  assert.equal(steps[1].tier, "cosmetic");
});

test("planSteps: stay, flip7, round_started, reshuffle", () => {
  const steps = planSteps([
    ev("round_started", { roundNumber: 2, dealer: "b" }), ev("reshuffle", { count: 30 }),
    ev("stay", { player: "b" }), ev("hit", { player: "a", card: 11 }), ev("flip7", { player: "a" }),
  ], g1(), opts);
  assert.deepEqual(kinds(steps), ["round-start", "reshuffle", "banked-stamp", "press-deck", "travel", "flip", "rest", "sort", "notches", "flip7-ring", "barrier"]);
  assert.equal(steps[0].caption, "Round 2 · Bo deals");
  assert.equal(steps[9].caption, "FLIP 7 +15");
  assert.equal(steps[9].ms, 900); assert.equal(steps[9].min, 400); assert.equal(steps[9].tier, "consequential");
  assert.equal(steps[8].ms, 350); assert.equal(steps[8].tier, "cosmetic");
});

test("planSteps: round_ended then game_over in one snapshot orders the sheet before the results", () => {
  const steps = planSteps([ev("stay", { player: "a" }), ev("round_ended", { results: {} }), ev("game_over", { winner: "a" })], g1(9), opts);
  assert.deepEqual(kinds(steps), ["banked-stamp", "sheet", "results", "barrier"]);
  assert.equal(steps[1].ms, 900); assert.equal(steps[1].min, 300);
  assert.equal(steps[2].ms, 1500); assert.equal(steps[2].min, 700);
  assert.equal(steps.at(-1).turnNumber, 9);
});

test("planSteps: reduced motion removes travel/shake/sweep/score-roll/token-arc and keeps holds", () => {
  const steps = planSteps([ev("hit", { player: "a", card: 8 }), ev("bust", { player: "a", card: 8 })], g1(), { ...opts, reducedMotion: true });
  const byKind = Object.fromEntries(steps.map((s) => [s.kind, s.ms]));
  assert.equal(byKind.travel, 0); assert.equal(byKind.shake, 0); assert.equal(byKind.sweep, 0); assert.equal(byKind["press-deck"], 0);
  assert.equal(byKind.flip, 120, "flip becomes the 120 ms colour emphasis");
  assert.equal(byKind.pair, 500); assert.equal(byKind.hold, 550);
});

test("planSteps: an empty event list still yields the barrier", () => {
  assert.deepEqual(kinds(planSteps([], g1(2), opts)), ["barrier"]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/sequence.test.mjs`
Expected: FAIL, `planSteps` is not exported.

- [ ] **Step 3: Implement `planSteps`**

Append to `public/js/sequence.js`:

```js
// Timings from spec §3.2. `min` is the catch-up floor for consequential steps.
export const T = {
  pressDeck: 70, travel: 240, flip: 190, rest: 220, sort: 160, restFlipThree: 300, beatFlipThree: 140, dealStagger: 110,
  actionHold: 450, toDiscard: 220, scoreRoll: 220,
  bustPair: 500, bustShake: 280, bustHold: 550, sweep: 320,
  scPair: 350, scFlash: 300, scDiscard: 300, tokenLand: 260, tokenArc: 360,
  freezeSweep: 320, bankedStamp: 260, notches: 350, flip7Ring: 900, reshuffle: 300, sheet: 900, results: 1500,
};
const MIN = { flip: 120, rest: 150, hold: 250, bustPair: 350, bustHold: 250, scPair: 400, scFlash: 150, sweep: 120, flip7Ring: 400, sheet: 300, results: 700 };
const REDUCED_ZERO = new Set(["press-deck", "travel", "shake", "sweep", "score-roll", "token-arc", "token-land", "sort", "to-discard", "to-token", "park", "reshuffle", "freeze-sweep", "notches"]);
// Events that belong to the reveal just before them (same player, or same `from`):
// they are planned inside the reveal group so a Flip Three or deal postlude follows them.
const CONSEQUENCE = new Set(["bust", "second_chance_saved", "second_chance_kept", "second_chance_given", "second_chance_discarded", "freeze", "flip_three_started", "set_aside"]);
const T_SC_PAIR = 400;

const step = (kind, tier, ms, fields = {}) => ({ kind, tier, ms, min: fields.min ?? 0, ...fields });
const S = (kind, ms, f) => step(kind, "structural", ms, f);
const C = (kind, ms, min, f) => step(kind, "consequential", ms, { ...f, min });
const X = (kind, ms, f) => step(kind, "cosmetic", ms, f);

const owner = (e) => e.player ?? e.from;
const belongs = (e, next) => !!next && CONSEQUENCE.has(next.type) && owner(next) === e.player;

// The reveal steps only; the caller appends the consequence and then the postlude.
function reveal(e, next, source) {
  const kind = cardKind(e.card);
  const at = { player: e.player, card: e.card };
  const out = [];
  if (source !== "dealt") out.push(S("press-deck", T.pressDeck, at));
  out.push(S("travel", T.travel, at), C("flip", T.flip, MIN.flip, at));
  const rest = source === "flip_three_card" ? T.restFlipThree : T.rest;
  if (kind === "number") {
    if (!(belongs(e, next) && (next.type === "bust" || next.type === "second_chance_saved"))) out.push(C("rest", rest, MIN.rest, at), S("sort", T.sort, at));
  } else if (kind === "modifier") {
    out.push(C("rest", rest, MIN.rest, at), S("sort", T.sort, at), X("score-roll", T.scoreRoll, at));
  } else {
    out.push(C("hold", T.actionHold, MIN.hold, at));
    const n = belongs(e, next) ? next.type : null;
    if (n === "set_aside") out.push(S("park", T.toDiscard, at));
    else if (n === "second_chance_kept") out.push(S("to-token", T.toDiscard, at));
    else out.push(S("to-discard", T.toDiscard, at));
  }
  return out;
}

function postlude(source, at) {
  if (source === "flip_three_card") return [S("beat", T.beatFlipThree, at), S("pip-remove", 0, at)];
  if (source === "dealt") return [S("beat", T.dealStagger, at)];
  return [];
}

function consequence(e, prev, nameOf) {
  switch (e.type) {
    case "bust": return [
      C("pair", T.bustPair, MIN.bustPair, { player: e.player, card: e.card, caption: `BUST · duplicate ${e.card}` }),
      S("shake", T.bustShake, { player: e.player }),
      C("hold", T.bustHold, MIN.bustHold, { player: e.player }),
      S("sweep", T.sweep, { player: e.player, card: e.card, min: MIN.sweep })];
    case "second_chance_saved": return [
      C("pair", T_SC_PAIR, MIN.scPair, { player: e.player, card: e.card, caption: "SECOND CHANCE" }),
      C("shield-flash", T.scFlash, MIN.scFlash, { player: e.player }),
      S("to-discard", T.scDiscard, { player: e.player, card: e.card, shield: true })];
    case "second_chance_kept": return [S("token-land", T.tokenLand, { player: e.player })];
    case "second_chance_given": return [S("token-arc", T.tokenArc, { from: e.from, to: e.to, caption: `${nameOf(e.from)} gives Second Chance to ${nameOf(e.to)}` })];
    case "second_chance_discarded": return [S("caption", 0, { caption: "Second Chance discarded" })];
    case "freeze": return [S("freeze-sweep", T.freezeSweep, { from: e.from, to: e.to, caption: `${nameOf(e.to)} is frozen` })];
    case "flip_three_started": return [S("pips-set", 0, { from: e.from, to: e.to, player: e.to, caption: `${nameOf(e.to)} must flip three` })];
    case "flip_three_ended": return [S("pips-clear", 0, { player: e.player })];
    case "set_aside": return []; // the reveal before it already parked the card
    case "stay": {
      const forced = prev && prev.type === "deck_exhausted" && prev.player === e.player;
      return [X("banked-stamp", T.bankedStamp, { player: e.player, caption: forced ? "No cards left · banked" : `${nameOf(e.player)} banks` })];
    }
    case "flip7": return [X("notches", T.notches, { player: e.player }), C("flip7-ring", T.flip7Ring, MIN.flip7Ring, { player: e.player, caption: "FLIP 7 +15" })];
    case "round_started": return [S("round-start", 0, { caption: `Round ${e.roundNumber} · ${nameOf(e.dealer)} deals` })];
    case "reshuffle": return [S("reshuffle", T.reshuffle, { caption: `Discard reshuffled (${e.count})` })];
    case "deck_exhausted": return [S("caption", 0, { caption: "No cards left to flip" })];
    case "round_ended": return [C("sheet", T.sheet, MIN.sheet, {})];
    case "game_over": return [C("results", T.results, MIN.results, { player: e.winner })];
    default: return [];
  }
}

export function planSteps(events, game, opts = {}) {
  const nameOf = opts.nameOf || ((id) => id);
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i], next = events[i + 1], prev = events[i - 1];
    if (e.type === "dealt" || e.type === "hit" || e.type === "flip_three_card") {
      out.push(...reveal(e, next, e.type));
      if (belongs(e, next)) { out.push(...consequence(next, e, nameOf)); i += 1; }
      out.push(...postlude(e.type, { player: e.player, card: e.card }));
    } else {
      out.push(...consequence(e, prev, nameOf));
    }
  }
  if (opts.reducedMotion) for (const s of out) { if (REDUCED_ZERO.has(s.kind)) s.ms = 0; else if (s.kind === "flip") s.ms = MIN.flip; }
  out.push(C("barrier", 0, 0, { turnNumber: game.turnNumber }));
  return out;
}
```

Walk the Task 3 tests through this code before running them: the Flip Three test's action hit is `hit flip_three` followed by `flip_three_started { from: "a" }`, which `belongs` (owner is `from`), so `pips-set` comes right after `to-discard`; each `flip_three_card` gets its `beat`/`pip-remove` postlude after any bust or save consequence; the parked freeze is `flip_three_card freeze` + `set_aside` (consumed, no steps) + postlude, and the later `freeze` event is planned on its own after `pips-clear`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/sequence.test.mjs`
Expected: PASS, 26 tests. If a step-order assertion fails, fix the planner, not the test: the orders in the tests are the spec.

- [ ] **Step 5: Commit**

```bash
git add public/js/sequence.js tests/sequence.test.mjs
git commit -m "Plan presentation steps from engine events"
```

---

### Task 4: `sequence.js` — `compress` and `totalMs`

**Files:**
- Modify: `public/js/sequence.js`
- Test: `tests/sequence.test.mjs`

**Interfaces:**
- Produces: `totalMs(steps)` → number; `compress(steps)` → new `Step[]` (cosmetic dropped, structural `ms` 0 except `sweep` → 120, consequential `ms` = `min`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/sequence.test.mjs` (add `compress, totalMs` to the import):

```js
test("totalMs sums step durations", () => {
  const steps = planSteps([ev("hit", { player: "a", card: 7 })], g1(), opts);
  assert.equal(totalMs(steps), 880);
});

test("compress drops cosmetic steps, zeroes structural ones except sweep, and floors consequential ones", () => {
  const steps = planSteps([ev("hit", { player: "a", card: "+4" }), ev("hit", { player: "b", card: 8 }), ev("bust", { player: "b", card: 8 })], g1(), opts);
  const c = compress(steps);
  assert.ok(!c.some((s) => s.kind === "score-roll"), "cosmetic dropped");
  assert.equal(c.find((s) => s.kind === "travel").ms, 0);
  assert.equal(c.find((s) => s.kind === "sweep").ms, 120);
  assert.equal(c.find((s) => s.kind === "flip").ms, 120);
  const pair = c.find((s) => s.kind === "pair"), hold = c.find((s) => s.kind === "hold");
  assert.equal(pair.ms + hold.ms, 600, "bust floor survives compression");
  const sc = compress(planSteps([ev("hit", { player: "a", card: 3 }), ev("second_chance_saved", { player: "a", card: 3 })], g1(), opts));
  assert.equal(sc.find((s) => s.kind === "pair").ms, 400, "Second Chance pair floor");
  assert.equal(c.at(-1).kind, "barrier");
  assert.ok(totalMs(c) < totalMs(steps));
  assert.notEqual(c, steps, "returns a new array");
  assert.equal(steps.find((s) => s.kind === "travel").ms, 240, "input untouched");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/sequence.test.mjs`
Expected: FAIL, `totalMs`/`compress` not exported.

- [ ] **Step 3: Implement**

Append to `public/js/sequence.js`:

```js
export function totalMs(steps) { return steps.reduce((n, s) => n + s.ms, 0); }

// Catch-up mode (spec §3.3): keep every consequential card readable at its
// floor, drop decoration, collapse movement.
export function compress(steps) {
  const out = [];
  for (const s of steps) {
    if (s.kind === "barrier") { out.push(s); continue; }   // by reference: the presenter's cap timer holds it
    if (s.tier === "cosmetic") continue;
    if (s.tier === "structural") { out.push({ ...s, ms: s.kind === "sweep" ? MIN.sweep : 0 }); continue; }
    out.push({ ...s, ms: Math.min(s.ms, s.min) });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/sequence.test.mjs`
Expected: PASS, 28 tests.

- [ ] **Step 5: Commit**

```bash
git add public/js/sequence.js tests/sequence.test.mjs
git commit -m "Add catch-up compression for the presentation queue"
```

---

### Task 5: `present.js` — the queue runner

**Files:**
- Create: `public/js/present.js`
- Test: `tests/present.test.mjs`

**Interfaces:**
- Consumes: `newEvents`, `planSteps`, `compress`, `totalMs`, `BUDGET_MS`, `BARRIER_CAP_MS` from `./sequence.js`.
- Produces: `createPresenter({ effects, clock, reducedMotion, nameOf })` → `{ enqueue(state), reset(), isIdle() }`.
  - `effects` contract (all optional except `render`): `render(state)` full reconcile and view switch; `preRender(state)` countdown plus disabled controls; `begin(step)` and `end(step)` around each step; `caption(text)`.
  - `clock` = `{ now(), setTimeout(fn, ms), clearTimeout(id) }`; defaults to `performance`/globals in the browser.
  - `nameOf(state)` → `(id) => name` used for captions; default looks up `state.game.players`.
- Behaviour (spec §3.1, §3.3, §3.5): cursor per game; `lobby` states and states without `game` flush and render immediately; new `gameId` flushes (cursor `0` if the previous state was `lobby`, so the first deal animates; else `null`); reset diffs render at once and caption `Catching up…` when a cursor existed; each snapshot's steps end with a barrier whose `state` is rendered when it runs; **only the newest barrier enables input**: when an older barrier runs while newer steps are queued, `render(step.state)` is immediately followed by `preRender(latest)` so controls stay disabled; queue over `BUDGET_MS` is compressed; every barrier arms a deadline timer at `arrivedAt + BARRIER_CAP_MS` that, if the barrier has not run, drops the steps ahead of it and cuts the active wait, so the barrier runs at the cap even mid-step; a `round-start` step arriving while a `sheet` step is active cuts the sheet's remaining wait to at most 300 ms.

- [ ] **Step 1: Write the failing tests**

Create `tests/present.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createPresenter } from "../public/js/present.js";

function clock() {
  let now = 0, seq = 0; const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { due: now + ms, fn, id }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const t of timers.values()) if (t.due <= end && (!next || t.due < next.due || (t.due === next.due && t.id < next.id))) next = t;
        if (!next) break;
        timers.delete(next.id); now = Math.max(now, next.due); next.fn();
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); // let the pump continue
      }
      now = end;
      await Promise.resolve(); await Promise.resolve();
    },
  };
}

function fx() {
  const log = [];
  return { log,
    render: (s) => log.push(["render", s.game ? s.game.turnNumber : s.phase]),
    preRender: (s) => log.push(["pre", s.game.turnNumber]),
    begin: (st) => log.push(["begin", st.kind]),
    end: (st) => log.push(["end", st.kind]),
    caption: (t) => log.push(["caption", t]),
  };
}

const ev = (type, fields = {}) => ({ type, turnNumber: 1, ...fields });
const snap = ({ phase = "playing", gameId = 1, turnNumber = 1, history = [], history_start = 0, you = "a" } = {}) =>
  ({ type: "state", phase, you, gameId, game: phase === "lobby" ? null : { phase: "round", turnNumber, history, history_start, players: [{ id: "a", name: "Ann" }, { id: "b", name: "Bo" }] } });

test("first snapshot renders immediately with no steps", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  p.enqueue(snap({ history: [ev("round_started"), ev("dealt", { player: "a", card: 5 })] }));
  assert.deepEqual(e.log, [["render", 1]]);
  assert.ok(p.isIdle());
});

test("a later snapshot pre-renders at once and renders only after its steps have played", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  const h = [ev("round_started"), ev("dealt", { player: "a", card: 5 })];
  p.enqueue(snap({ history: h }));
  e.log.length = 0;
  p.enqueue(snap({ turnNumber: 2, history: [...h, ev("hit", { player: "a", card: 7 })] }));
  assert.deepEqual(e.log[0], ["pre", 2]);
  assert.deepEqual(e.log[1], ["begin", "press-deck"]);
  assert.ok(!e.log.some((l) => l[0] === "render"));
  await c.advance(879);
  assert.ok(!e.log.some((l) => l[0] === "render"), "not yet: 880 ms of steps");
  await c.advance(1);
  assert.deepEqual(e.log.at(-1), ["render", 2]);
  assert.deepEqual(e.log.filter((l) => l[0] === "begin").map((l) => l[1]), ["press-deck", "travel", "flip", "rest", "sort", "barrier"]);
  assert.ok(p.isIdle());
});

test("lobby to playing animates the first deal (cursor starts at 0)", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  p.enqueue(snap({ phase: "lobby", gameId: null }));
  assert.deepEqual(e.log, [["render", "lobby"]]);
  e.log.length = 0;
  p.enqueue(snap({ gameId: 1, history: [ev("round_started", { roundNumber: 1, dealer: "a" }), ev("dealt", { player: "a", card: 5 }), ev("dealt", { player: "b", card: 9 })] }));
  assert.ok(e.log.some((l) => l[0] === "begin" && l[1] === "travel"), "the deal travels");
  await c.advance(5000);
  assert.deepEqual(e.log.at(-1), ["render", 1]);
});

test("a repeated snapshot enqueues nothing new", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  const s = snap({ history: [ev("round_started")] });
  p.enqueue(s); e.log.length = 0;
  p.enqueue(s);
  assert.deepEqual(e.log, [["pre", 1], ["begin", "barrier"], ["end", "barrier"], ["render", 1]]);
});

test("a window that slid past the cursor resets and captions Catching up", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  p.enqueue(snap({ history: [ev("round_started")] })); e.log.length = 0;
  p.enqueue(snap({ turnNumber: 30, history: [ev("hit", { player: "a", card: 1 })], history_start: 50 }));
  assert.deepEqual(e.log, [["render", 30], ["caption", "Catching up…"]]);
});

test("a new gameId mid-game flushes the queue and resets the cursor", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  const h = [ev("round_started")];
  p.enqueue(snap({ history: h }));
  p.enqueue(snap({ turnNumber: 2, history: [...h, ev("hit", { player: "a", card: 7 })] }));
  await c.advance(100);
  e.log.length = 0;
  p.enqueue(snap({ gameId: 2, turnNumber: 1, history: [ev("round_started")] }));
  assert.deepEqual(e.log, [["render", 1]]);
  await c.advance(2000);
  assert.ok(!e.log.some((l) => l[0] === "end" && l[1] !== "barrier"), "no step from the old game finishes after the flush");
});

test("queued playtime over the budget is compressed", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  const h = [ev("round_started")];
  p.enqueue(snap({ history: h }));
  const hits = [ev("hit", { player: "a", card: "+4" }), ev("hit", { player: "b", card: "+2" }), ev("hit", { player: "a", card: "x2" }), ev("hit", { player: "b", card: 3 })]; // 4 x 880 + 3 x 220 = 4180 ms
  p.enqueue(snap({ turnNumber: 5, history: [...h, ...hits] }));
  await c.advance(10000);
  const begun = e.log.filter((l) => l[0] === "begin").map((l) => l[1]);
  assert.ok(!begun.includes("score-roll"), "cosmetic steps were dropped");
  assert.deepEqual(e.log.at(-1), ["render", 5]);
});

test("a barrier runs at the 4 s cap even while an earlier step is mid-wait", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  const h = [ev("round_started")];
  p.enqueue(snap({ history: h }));
  const many = Array.from({ length: 16 }, (_, i) => ev("hit", { player: i % 2 ? "a" : "b", card: i % 13 }));
  p.enqueue(snap({ turnNumber: 17, history: [...h, ...many] })); // compressed: 16 x (120 + 150) = 4320 ms, past the cap
  await c.advance(3999);
  assert.ok(!e.log.some((l) => l[0] === "render" && l[1] === 17), "not before the cap");
  await c.advance(1);
  assert.ok(e.log.some((l) => l[0] === "render" && l[1] === 17), "rendered exactly at the cap");
  assert.equal(c.now(), 4000);
});

test("an older barrier renders its snapshot but hands control back to the latest one (no stale input window)", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  const h = [ev("round_started")];
  p.enqueue(snap({ history: h }));
  const h2 = [...h, ev("hit", { player: "b", card: 7 })];
  p.enqueue(snap({ turnNumber: 2, history: h2 }));
  p.enqueue(snap({ turnNumber: 3, history: [...h2, ev("hit", { player: "a", card: 9 })] }));
  await c.advance(880);
  const i = e.log.findIndex((l) => l[0] === "render" && l[1] === 2);
  assert.ok(i > 0, "turn 2 barrier rendered");
  assert.deepEqual(e.log[i + 1], ["pre", 3], "immediately re-disabled by the latest snapshot's pre-render");
  await c.advance(880);
  assert.deepEqual(e.log.at(-1), ["render", 3]);
});

test("a new round arriving while the sheet is up cuts the sheet wait to 300 ms", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  const h = [ev("round_started")];
  p.enqueue(snap({ history: h }));
  p.enqueue(snap({ turnNumber: 5, history: [...h, ev("stay", { player: "a" }), ev("round_ended", { results: {} })] })); // banked-stamp 260 + sheet 900
  await c.advance(300); // 40 ms into the sheet
  assert.deepEqual(e.log.at(-1), ["begin", "sheet"]);
  p.enqueue(snap({ turnNumber: 6, history: [ev("round_started", { roundNumber: 2, dealer: "b" }), ev("dealt", { player: "a", card: 4 })], history_start: 3 }));
  await c.advance(300);
  assert.ok(e.log.some((l) => l[0] === "end" && l[1] === "sheet"), "sheet ended 300 ms after the new round arrived, not 860 ms");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/present.test.mjs`
Expected: FAIL, cannot find `../public/js/present.js`.

- [ ] **Step 3: Implement**

Create `public/js/present.js`:

```js
// The presentation queue (spec §3.1, §3.3, §3.5). No DOM here: effects are
// injected so node tests can drive the queue with a fake clock.
import { newEvents, planSteps, compress, totalMs, BUDGET_MS, BARRIER_CAP_MS } from "./sequence.js";

const defaultClock = { now: () => performance.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) };
const noop = () => {};
const defaultNameOf = (state) => { const m = new Map((state.game?.players || []).map((p) => [p.id, p.name])); return (id) => m.get(id) || id; };

export function createPresenter({ effects, clock = defaultClock, reducedMotion = false, nameOf = defaultNameOf }) {
  const fx = { preRender: noop, begin: noop, end: noop, caption: noop, ...effects };
  let cursor = null, gameId = null, phase = null, latest = null;
  let queue = [], busy = false, gen = 0;
  let active = null;               // { step, resolve, timer } while a step is waiting
  const deadlines = new Set();     // clock timer ids for barrier caps

  // A cancellable wait: cut(ms) shortens the remaining wait to at most `ms`.
  function wait(step, ms) {
    return new Promise((resolve) => {
      const done = () => { if (active && active.step === step) { clock.clearTimeout(active.timer); active = null; } resolve(); };
      active = { step, resolve: done, timer: clock.setTimeout(done, ms) };
    });
  }
  function cutActive(afterMs) {
    if (!active) return;
    clock.clearTimeout(active.timer);
    const a = active; a.timer = clock.setTimeout(a.resolve, afterMs);
  }
  function flush() {
    queue = []; gen += 1; busy = false;
    if (active) { clock.clearTimeout(active.timer); active = null; }
    for (const id of deadlines) clock.clearTimeout(id); deadlines.clear();
  }
  // Barrier cap: when it fires and the barrier is still queued, drop everything
  // ahead of it and cut the active wait so the barrier runs now.
  function armCap(barrier) {
    const id = clock.setTimeout(() => {
      deadlines.delete(id);
      const idx = queue.indexOf(barrier);
      if (idx < 0) return;
      queue.splice(0, idx);
      cutActive(0);
    }, BARRIER_CAP_MS);
    deadlines.add(id);
  }

  async function pump() {
    busy = true;
    const myGen = gen;
    while (queue.length && myGen === gen) {
      const step = queue.shift();
      fx.begin(step);
      if (step.ms > 0) await wait(step, step.ms);
      if (myGen !== gen) return;
      fx.end(step);
      if (step.kind === "barrier") {
        fx.render(step.state);
        if (queue.some((s) => s.kind === "barrier")) fx.preRender(latest);   // an older barrier never enables input
      }
    }
    if (myGen === gen) busy = false;
  }

  return {
    enqueue(state) {
      const prevPhase = phase; phase = state.phase;
      if (!state.game || state.phase === "lobby") { flush(); cursor = null; gameId = state.gameId ?? null; latest = state; fx.render(state); return; }
      if (state.gameId !== gameId) { flush(); gameId = state.gameId; cursor = prevPhase === "lobby" ? 0 : null; }
      latest = state;
      const hadCursor = cursor !== null;
      const r = newEvents(cursor, state.game);
      cursor = r.cursor;
      if (r.reset) { flush(); fx.render(state); if (hadCursor) fx.caption("Catching up…"); return; }
      const steps = planSteps(r.events, state.game, { you: state.you, reducedMotion, nameOf: nameOf(state) });
      const barrier = steps[steps.length - 1];
      barrier.state = state; barrier.arrivedAt = clock.now();
      if (active && active.step.kind === "sheet" && steps.some((s) => s.kind === "round-start")) cutActive(300);
      queue.push(...steps);
      armCap(barrier);
      fx.preRender(state);
      if (totalMs(queue) > BUDGET_MS) queue = compress(queue);
      if (!busy) pump();
    },
    reset() { flush(); cursor = null; gameId = null; phase = null; latest = null; },
    isIdle() { return !busy && queue.length === 0; },
  };
}
```

`compress` returns new step objects, so after compression the barrier object the cap timer captured is no longer the one in the queue. Make `compress` keep barrier steps by reference: in Task 4's `compress`, push `s` itself (not a copy) when `s.kind === "barrier"`. Add that line to Task 4 now: `if (s.kind === "barrier") { out.push(s); continue; }` as the first statement in the loop.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/present.test.mjs`
Expected: PASS, 10 tests. The fake clock runs a timer callback and then drains microtasks three times before looking for the next due timer; the pump's `await wait()` resolves within those drains and immediately calls `clock.setTimeout` for the next step, which the loop then finds. If a test cannot observe a render, raise the drain count in `advance` (it is a plain loop); do not add real timers or `setImmediate`.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test` (expected all green, 106 + 28 + 10 = 144).

```bash
git add public/js/present.js tests/present.test.mjs
git commit -m "Add the presentation queue runner with barrier, catch-up, and reset rules"
```

---

### Task 6: Shell markup and the felt-table stylesheet

**Files:**
- Rewrite: `public/index.html`, `public/styles.css`

**Interfaces:**
- Produces the DOM ids later tasks rely on. Table view: `#tableView` containing `.turn-strip` (`#turnWho`, `#caption[aria-live=polite]`, `#countdown` with `<svg class="ring"><circle class="track"/><circle class="arc"/></svg><b id="countNum"></b>`), `<ul id="seats" class="seats">`, `.draw-zone` with `#deck.deck` (`<span class="count" id="deckCount">`) and `#discard.discard` (`<span class="under u1"></span><span class="under u2"></span><span class="top" id="discardTop"></span>`), `<div id="yourRail" class="your-rail">`, `#controls` with `#hitBtn` and `#stayBtn` (each has `<span class="label">` and `<span class="spinner" hidden>`), `#targetPicker`, `<div id="fxLayer" class="fx-layer" aria-hidden="true">`, `<details class="log">` unchanged. Sheet: `<div id="summarySheet" class="summary-sheet" hidden>` with `#roundTitle`, `<table id="roundTable">` (thead `This round | Total`), `#nextRoundBtn` containing `<span class="label">Next round</span><span class="track" id="nextTrack"></span>`.
- Seat markup, produced by `table.js` in Task 7, is styled here:

```html
<li class="seat status-active current you" data-player="p1">
  <div class="seat-head"><span class="name">Ann</span><span class="dealer" title="dealer">D</span><span class="status-glyph"></span><span class="banked">120</span></div>
  <div class="hand"><span class="playing-card number" data-key="n:8" aria-label="number 8"><b>8</b><i class="idx">8</i><i class="notches" style="--n:3"></i></span>
    <span class="playing-card modifier" data-key="m:+4:0" aria-label="plus 4"><b>+4</b></span>
    <span class="shield" hidden aria-label="holds a Second Chance"></span>
    <span class="pips" hidden><i></i><i></i><i></i></span></div>
  <div class="seat-foot"><span class="round-score">27</span><span class="stamp" hidden>BANKED</span></div>
</li>
```

- Card classes: `.playing-card` plus one of `.number`, `.modifier`, `.action`, `.back`; size classes `.sm` (36×50, opponents) and default (50×70, yours); `.reveal` (58×82, in the fx layer, `position: fixed`, transforms set by effects.js); state classes `.dup` (danger outline), `.frozen` on `.hand`, `.new` (120 ms emphasis under reduced motion).

- [ ] **Step 1: Rewrite `public/index.html`**

Keep the `<head>` but add before the stylesheet link:

```html
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&display=swap">
```

and set `<meta name="theme-color" content="#111917">`. Body:

```html
<body>
  <header class="topbar">
    <a class="brand" href="/">Flip 7</a>
    <span id="roomCode" class="room-code" hidden></span>
    <span id="connPill" class="pill" hidden>reconnecting…</span>
  </header>

  <section id="landingView" class="view landing" hidden>
    <div class="hero" aria-hidden="true">
      <span class="playing-card number fan"><b>3</b></span><span class="playing-card number fan"><b>7</b></span><span class="playing-card modifier fan"><b>×2</b></span>
      <span class="playing-card number fan"><b>12</b></span><span class="playing-card action fan"><b>Freeze</b></span><span class="playing-card number fan"><b>9</b></span><span class="playing-card back fan"></span>
    </div>
    <h1>Flip 7</h1>
    <p class="lede">Press your luck. Hit or stay. Seven different numbers ends the round.</p>
    <div class="panel">
      <label>Your name <input id="nameInput" maxlength="16" autocomplete="nickname"></label>
      <button id="quickPlayBtn" class="primary big">Quick play</button>
    </div>
    <div class="secondary">
      <button id="friendsBtn">Play with friends</button>
      <form id="joinForm" class="join-form">
        <input id="joinCode" maxlength="4" placeholder="room code" autocapitalize="none" autocomplete="off">
        <button type="submit">Join</button>
      </form>
    </div>
    <p class="foot-links"><a href="/how-to-play">How to play</a> · <a href="/agent-protocol">Agent protocol</a></p>
  </section>

  <section id="joinView" class="view" hidden>
    <h2>Join room <span class="code-inline" data-room></span></h2>
    <p class="hint">Share the link so a friend can take a seat too.</p>
    <label>Your name <input id="joinName" maxlength="16"></label>
    <div class="actions">
      <button id="joinBtn" class="primary">Sit down</button>
      <button id="joinCopyLinkBtn">Copy link</button>
    </div>
    <p id="joinError" class="error" hidden></p>
  </section>

  <section id="lobbyView" class="view" hidden>
    <button id="copyLinkBtn" class="code-big" title="Copy link"><span class="code-label">Room</span><span class="code-inline" data-room></span><span class="code-hint">tap to copy</span></button>
    <p class="hint">Share the link. 2 to 6 players. First to 200 wins.</p>
    <div class="felt-panel"><ul id="seatList" class="seat-list"></ul></div>
    <div class="actions">
      <button id="addBotBtn">Add bot</button>
      <button id="startBtn" class="primary">Start game</button>
    </div>
  </section>

  <section id="tableView" class="view table" hidden>
    <div class="turn-strip">
      <span id="turnWho" class="turn-who"></span>
      <span id="caption" class="caption" aria-live="polite"></span>
      <span id="countdown" class="countdown" hidden>
        <svg class="ring" viewBox="0 0 40 40" aria-hidden="true"><circle class="track" cx="20" cy="20" r="17"/><circle class="arc" cx="20" cy="20" r="17"/></svg>
        <b id="countNum"></b>
      </span>
    </div>
    <ul id="seats" class="seats"></ul>
    <div class="draw-zone">
      <div id="deck" class="deck" aria-label="deck"><span class="playing-card back sm"></span><span class="playing-card back sm"></span><span class="playing-card back sm"></span><span class="count" id="deckCount"></span></div>
      <div id="discard" class="discard" aria-label="discard"><span class="under u1"></span><span class="under u2"></span><span class="top" id="discardTop"></span><span class="parked" id="parked"></span></div>
    </div>
    <div id="yourRail" class="your-rail"></div>
    <div id="controls" class="controls" hidden>
      <button id="hitBtn" class="primary big"><span class="label">Hit</span><span class="spinner" hidden></span></button>
      <button id="stayBtn" class="big stay"><span class="label">Stay</span><span class="spinner" hidden></span></button>
    </div>
    <div id="targetPicker" class="target-picker" hidden></div>
    <details class="log"><summary>Log</summary><ul id="logList"></ul></details>
    <div id="fxLayer" class="fx-layer" aria-hidden="true"></div>
  </section>

  <div id="summarySheet" class="summary-sheet" hidden>
    <div class="sheet">
      <h2 id="roundTitle"></h2>
      <table id="roundTable"><thead><tr><th></th><th>This round</th><th>Total</th></tr></thead><tbody></tbody></table>
      <button id="nextRoundBtn" class="primary"><span class="label">Next round</span><span class="track" id="nextTrack"></span></button>
    </div>
  </div>

  <section id="resultsView" class="view results" hidden>
    <div class="winner">
      <div class="fan" id="winnerFan" aria-hidden="true"></div>
      <h2 id="winnerLine"></h2>
      <p class="final-score" id="winnerScore"></p>
    </div>
    <ol id="standings"></ol>
    <div class="actions">
      <button id="playAgainBtn" class="primary big">Play again</button>
      <button id="resultsCopyLinkBtn" class="quiet">Copy room link</button>
    </div>
  </section>

  <section id="howToPlayView" class="view" hidden>
    ...unchanged rules list from the current file...
  </section>

  <div id="toast" class="toast" hidden></div>
  <div id="live" aria-live="polite" class="sr-only"></div>
  <script type="module" src="/js/app.js"></script>
</body>
```

(Copy the how-to-play `<ol class="rules">` verbatim from the current file.)

- [ ] **Step 2: Rewrite `public/styles.css`**

Write the stylesheet from these blocks. Where a block says "per spec", use the exact numbers from spec §4; nothing is left to taste.

```css
/* Flip 7 — a midnight-green dealer table. The shared draw zone is the memorable
   thing: every consequential card travels from the deck to a player before the
   interface settles. Numbers are warm paper, actions coral, modifiers cyan. */

:root {
  --rail: #111917; --felt: #071C1A; --felt-light: #0D2A26; --surface: #172421;
  --paper: #F4E6C5; --ink: #171914; --gold: #F6B941; --cyan: #50C7D9; --coral: #F06A62;
  --danger: #FF4D55; --success: #55D68B; --text: #F2EEE3; --muted: #9AADA7; --edge: #30443F;
  --teal-back: #0F3B3A; --radius: 12px;
  --move: cubic-bezier(.22,.8,.24,1); --snap: cubic-bezier(.2,1.35,.35,1);
  --card-w: 50px; --card-h: 70px; --card-w-sm: 36px; --card-h-sm: 50px; --card-w-xl: 58px; --card-h-xl: 82px;
  --ui: "Segoe UI Variable Text", "Segoe UI", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --deck: "Barlow Condensed", "Bahnschrift", "Arial Narrow", ui-sans-serif, sans-serif;
  color-scheme: dark;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; min-height: 100dvh; background: var(--rail); color: var(--text); font-family: var(--ui); font-size: 16px; line-height: 1.45; overflow-x: hidden; font-variant-numeric: tabular-nums; }
h1, h2, h3 { margin: 0 0 .4em; font-family: var(--deck); font-weight: 700; line-height: 1.05; }
h1 { font-size: 3.4rem; font-weight: 800; letter-spacing: .01em; }
h2 { font-size: 1.7rem; }
a { color: var(--gold); text-underline-offset: 3px; }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }

/* top rail: 44px */
.topbar { display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 max(16px, env(safe-area-inset-left)) 0 max(16px, env(safe-area-inset-right)); background: var(--rail); border-bottom: 1px solid var(--edge); position: sticky; top: 0; z-index: 20; }
.brand { font-family: var(--deck); font-size: 1.3rem; font-weight: 800; color: var(--text); text-decoration: none; }
.room-code { font-family: var(--deck); letter-spacing: .22em; color: var(--gold); }
.pill { margin-left: auto; padding: 3px 11px; border-radius: 999px; border: 1px solid var(--coral); color: var(--coral); font-size: .8rem; }

.view { width: 100%; max-width: 720px; margin: 0 auto; padding: 22px max(16px, env(safe-area-inset-right)) 32px max(16px, env(safe-area-inset-left)); }

/* buttons */
button { font: inherit; font-weight: 600; color: var(--text); min-height: 44px; padding: 10px 18px; border: 1px solid var(--edge); border-radius: var(--radius); background: var(--surface); cursor: pointer; transition: background-color 120ms ease, border-color 120ms ease, transform 90ms ease; position: relative; }
button:active:not(:disabled) { transform: translateY(1px); }
button:disabled { opacity: .55; cursor: not-allowed; }
button.primary { background: linear-gradient(180deg, #FFD36B, var(--gold)); border-color: #C98F1B; color: #2A1B02; }
button.stay { border-color: var(--success); color: var(--success); background: transparent; }
button.quiet { border: 0; background: none; color: var(--muted); text-decoration: underline; }
.big { min-height: 56px; font-size: 1.125rem; font-family: var(--deck); font-weight: 700; letter-spacing: .02em; }
.spinner { display: inline-block; width: 14px; height: 14px; margin-left: 8px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin 700ms linear infinite; vertical-align: -2px; }
@keyframes spin { to { transform: rotate(360deg); } }
label { display: block; margin: 0 0 14px; color: var(--muted); font-size: .875rem; }
input { display: block; width: 100%; margin-top: 6px; padding: 12px 14px; border: 1px solid var(--edge); border-radius: var(--radius); background: var(--rail); color: var(--text); font: inherit; }
input:focus-visible { border-color: var(--gold); }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 4px 0 20px; }
.actions button { flex: 1 1 160px; }

/* ---------- playing cards ---------- */
.playing-card { position: relative; display: inline-flex; align-items: center; justify-content: center; width: var(--card-w); height: var(--card-h); border-radius: 6px; font-family: var(--deck); font-weight: 800; line-height: 1; flex: 0 0 auto; box-shadow: 0 2px 4px rgba(0,0,0,.45); transform-origin: 50% 50%; }
.playing-card.sm { width: var(--card-w-sm); height: var(--card-h-sm); border-radius: 4px; }
.playing-card.reveal { width: var(--card-w-xl); height: var(--card-h-xl); position: fixed; left: 0; top: 0; z-index: 40; will-change: transform; }
.playing-card b { font-size: 34px; }
.playing-card.sm b { font-size: 22px; }
.playing-card.reveal b { font-size: 40px; }
.playing-card.number { background: var(--paper); color: var(--ink); }
.playing-card.number .idx { position: absolute; right: 4px; bottom: 9px; font-size: 12px; font-style: normal; font-weight: 700; transform: rotate(180deg); }
.playing-card.sm .idx { display: none; }
/* seven notches: --n of them filled */
.playing-card.number .notches { position: absolute; left: 6px; right: 6px; bottom: 3px; height: 3px; background: linear-gradient(90deg, var(--gold) calc(var(--n, 0) * 100% / 7), rgba(23,25,20,.18) 0); -webkit-mask: repeating-linear-gradient(90deg, #000 0 11%, transparent 11% 14.2857%); mask: repeating-linear-gradient(90deg, #000 0 11%, transparent 11% 14.2857%); }
.playing-card.modifier { background: var(--cyan); color: #06333B; background-image: repeating-linear-gradient(45deg, rgba(0,0,0,.06) 0 4px, transparent 4px 8px); }
.playing-card.modifier b { font-size: 24px; }
.playing-card.sm.modifier b { font-size: 16px; }
.playing-card.action { background: var(--coral); color: #fff; flex-direction: column; gap: 3px; }
.playing-card.action b { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
.playing-card.action svg { width: 22px; height: 22px; fill: none; stroke: #fff; stroke-width: 2; }
.playing-card.sm.action svg { width: 16px; height: 16px; }
.playing-card.back { background: var(--teal-back); border: 2px solid var(--gold); box-shadow: inset 0 0 0 3px var(--teal-back), inset 0 0 0 4px var(--gold), 0 2px 4px rgba(0,0,0,.45); color: var(--gold); }
.playing-card.back::after { content: "7"; font-size: 20px; width: 26px; height: 26px; display: grid; place-items: center; background: var(--gold); color: var(--teal-back); clip-path: polygon(50% 0%, 90% 20%, 100% 60%, 75% 100%, 25% 100%, 0% 60%, 10% 20%); }
.playing-card.sm.back::after { font-size: 13px; width: 18px; height: 18px; }
.playing-card.dup { outline: 3px solid var(--danger); outline-offset: 1px; }
.playing-card.new { animation: emphasis 120ms ease both; }
@keyframes emphasis { from { filter: brightness(1.6); } to { filter: none; } }
.shield { display: inline-grid; place-items: center; width: 22px; height: 26px; align-self: center; background: var(--coral); color: #fff; clip-path: polygon(50% 0, 100% 18%, 92% 70%, 50% 100%, 8% 70%, 0 18%); font-size: 12px; font-family: var(--deck); }
.shield::after { content: "2"; }
.shield.flash { animation: flash 300ms ease both; }
@keyframes flash { 0% { transform: scale(1); } 50% { transform: scale(1.8); filter: brightness(1.6); } 100% { transform: scale(1); } }

/* ---------- table ---------- */
.table { position: relative; padding-top: 0; background: radial-gradient(120% 60% at 50% 30%, var(--felt-light), var(--felt) 70%); border-radius: 0 0 24px 24px; min-height: calc(100dvh - 44px); padding-bottom: 96px; }
.turn-strip { position: sticky; top: 44px; z-index: 15; display: flex; align-items: center; gap: 10px; height: 46px; margin: 0 -16px 12px; padding: 0 16px; background: rgba(7,28,26,.92); backdrop-filter: blur(6px); border-bottom: 1px solid var(--edge); }
.turn-who { font-family: var(--deck); font-weight: 700; font-size: 1.05rem; white-space: nowrap; }
.turn-strip.mine .turn-who { color: var(--gold); }
.caption { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: .9rem; }
.caption.loud { color: var(--danger); font-family: var(--deck); font-weight: 800; font-size: 1.1rem; letter-spacing: .03em; }
.caption.gold { color: var(--gold); font-family: var(--deck); font-weight: 800; font-size: 1.1rem; }
.countdown { position: relative; width: 36px; height: 36px; display: grid; place-items: center; }
.countdown .ring { position: absolute; inset: 0; transform: rotate(-90deg); }
.countdown circle { fill: none; stroke-width: 3; }
.countdown .track { stroke: var(--edge); }
.countdown .arc { stroke: var(--muted); stroke-dasharray: 106.8; stroke-dashoffset: calc(106.8 * (1 - var(--p, 1))); transition: stroke-dashoffset 250ms linear, stroke 250ms; }
.countdown.warn .arc { stroke: var(--gold); } .countdown.hot .arc { stroke: var(--coral); } .countdown.crit .arc { stroke: var(--danger); }
.countdown b { font-family: var(--deck); font-size: .95rem; }
.countdown.crit b { animation: tick 900ms var(--snap); }
@keyframes tick { 0% { transform: scale(1.35); } 100% { transform: scale(1); } }

.seats { list-style: none; margin: 0 0 12px; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.seats .seat:nth-child(5):last-child { grid-column: 1 / -1; }
.seat { position: relative; min-height: 76px; padding: 8px 10px; border-radius: var(--radius); background: rgba(23,36,33,.85); border: 1px solid var(--edge); border-left: 3px solid transparent; transition: border-color 180ms var(--move), background-color 180ms; }
.seat.current { border-left-color: var(--gold); box-shadow: 0 0 0 1px rgba(246,185,65,.35); }
.seat-head { display: flex; align-items: baseline; gap: 6px; font-size: .875rem; }
.seat-head .name { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.seat-head .dealer { font-family: var(--deck); font-size: .7rem; padding: 0 5px; border-radius: 4px; background: var(--gold); color: var(--ink); }
.seat-head .banked { margin-left: auto; font-family: var(--deck); font-weight: 700; color: var(--gold); }
.status-glyph::before { font-size: .75rem; color: var(--muted); }
.status-stayed .status-glyph::before { content: "banked"; color: var(--success); }
.status-frozen .status-glyph::before { content: "❄ frozen"; color: var(--cyan); }
.status-busted .status-glyph::before { content: "bust"; color: var(--danger); }
.hand { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 4px; min-height: var(--card-h-sm); margin-top: 6px; perspective: 700px; }
.seats .hand .playing-card { margin-right: -10px; }
.seats .hand .playing-card:last-of-type { margin-right: 0; }
.hand.frozen .playing-card { filter: saturate(.65) brightness(.85); }
.status-busted .hand { opacity: .35; }
.seat-foot { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.round-score { font-family: var(--deck); font-weight: 700; color: var(--text); }
.round-score.roll { animation: roll 220ms var(--snap); }
@keyframes roll { from { transform: translateY(-6px); opacity: .2; } to { transform: none; opacity: 1; } }
.stamp { font-family: var(--deck); font-weight: 800; font-size: .75rem; letter-spacing: .08em; padding: 1px 6px; border: 2px solid var(--success); color: var(--success); border-radius: 4px; transform: rotate(-6deg); animation: stamp 260ms var(--snap) both; }
@keyframes stamp { from { transform: rotate(-6deg) scale(1.6); opacity: 0; } to { transform: rotate(-6deg) scale(1); opacity: 1; } }
.pips { display: inline-flex; gap: 3px; align-self: center; }
.pips i { width: 8px; height: 11px; border-radius: 2px; background: var(--teal-back); border: 1px solid var(--gold); }

.draw-zone { display: flex; justify-content: center; align-items: flex-end; gap: 28px; margin: 6px 0 12px; }
.deck, .discard { position: relative; width: var(--card-w-sm); height: var(--card-h-sm); }
.deck .playing-card { position: absolute; left: 0; top: 0; }
.deck .playing-card:nth-child(2) { transform: translate(1px, -2px); } .deck .playing-card:nth-child(3) { transform: translate(2px, -4px); }
.deck.press .playing-card:nth-child(3) { transform: translate(2px, -1px); transition: transform 70ms; }
.deck .count { position: absolute; left: 50%; bottom: -18px; transform: translateX(-50%); font-family: var(--deck); font-size: .8rem; color: var(--muted); }
.discard .under { position: absolute; inset: 0; border-radius: 4px; background: #0b1917; border: 1px solid var(--edge); }
.discard .u1 { transform: rotate(-6deg) translate(-2px, 1px); } .discard .u2 { transform: rotate(2deg) translate(1px, -1px); }
.discard .top { position: absolute; inset: 0; transform: rotate(4deg); }
.discard .parked { position: absolute; left: calc(100% + 8px); top: 0; display: flex; gap: 4px; }
.discard .parked .playing-card { opacity: .9; outline: 1px dashed var(--gold); }

.your-rail { position: relative; padding: 10px 12px 12px; border-radius: var(--radius); background: linear-gradient(180deg, var(--surface), #101a18); border: 1px solid var(--edge); box-shadow: 0 -8px 24px rgba(0,0,0,.35); }
.your-rail .seat { min-height: 0; padding: 0; background: none; border: 0; }
.your-rail .seat-head { font-size: 1rem; } .your-rail .banked { font-size: 1.25rem; } .your-rail .round-score { font-size: 1.5rem; }
.your-rail .hand { gap: 6px; min-height: var(--card-h); }
.your-rail.sweep-gold::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; background: linear-gradient(100deg, transparent 30%, rgba(246,185,65,.28) 50%, transparent 70%); animation: sweep-gold 600ms var(--move) both; }
@keyframes sweep-gold { from { transform: translateX(-100%); } to { transform: translateX(100%); } }

.controls { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; display: flex; gap: 10px; padding: 10px 16px calc(10px + env(safe-area-inset-bottom)); background: linear-gradient(180deg, rgba(17,25,23,0), var(--rail) 35%); max-width: 720px; margin: 0 auto; }
#hitBtn { flex: 3 1 0; } #stayBtn { flex: 2 1 0; }
#hitBtn.pulse { animation: pulse 700ms var(--snap) 1; }
@keyframes pulse { 0% { transform: scale(1); } 40% { transform: scale(1.04); } 100% { transform: scale(1); } }
.target-picker { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; display: grid; gap: 8px; max-width: 720px; margin: 0 auto; padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); background: var(--rail); border-top: 1px solid var(--coral); }
.target-picker p { margin: 0 0 2px; color: var(--coral); font-weight: 600; }
.target-picker button { width: 100%; text-align: left; }
.fx-layer { position: fixed; inset: 0; pointer-events: none; z-index: 40; }

/* reveal card flight: effects.js sets --x/--y (translate to target) and toggles classes */
.playing-card.reveal { transform: translate(var(--x, 0px), var(--y, 0px)) rotateY(var(--ry, 0deg)); transition: transform var(--dur, 240ms) var(--move); backface-visibility: hidden; }
.playing-card.reveal.flipping { transition: transform var(--dur, 190ms) ease-in-out; }
.seat.shake, .your-rail .seat.shake { animation: shake 280ms ease both; }
@keyframes shake { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-6px); } 80% { transform: translateX(6px); } }
.hand.sweeping .playing-card { transition: transform 320ms var(--move), opacity 320ms; transform: translate(var(--sx, 0px), var(--sy, 0px)) scale(.6); opacity: 0; }
.hand.freeze-sweep::after { content: ""; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, rgba(80,199,217,.35) 50%, transparent 70%); animation: sweep-gold 320ms var(--move) both; }
.seat.flip7 { animation: ring 900ms var(--move) both; }
@keyframes ring { 0% { box-shadow: 0 0 0 0 rgba(246,185,65,.7); } 100% { box-shadow: 0 0 0 24px rgba(246,185,65,0); } }

/* log */
.log { margin-top: 14px; border-top: 1px solid var(--edge); padding-top: 8px; }
.log summary { color: var(--muted); font-size: .875rem; cursor: pointer; }
.log ul { list-style: none; margin: 6px 0 0; padding: 0; max-height: 240px; overflow-y: auto; }
.log li { padding: 5px 0; border-bottom: 1px solid rgba(48,68,63,.5); color: var(--muted); font-size: .8125rem; }

/* ---------- summary sheet ---------- */
.summary-sheet { position: fixed; inset: 0; z-index: 50; display: flex; align-items: flex-end; justify-content: center; background: rgba(0,0,0,.55); }
.summary-sheet .sheet { width: 100%; max-width: 480px; max-height: 84dvh; overflow-y: auto; padding: 18px 18px calc(18px + env(safe-area-inset-bottom)); border-radius: 18px 18px 0 0; background: var(--surface); border-top: 3px solid var(--gold); animation: sheet-up 260ms var(--move) both; }
@keyframes sheet-up { from { transform: translateY(100%); } to { transform: none; } }
#roundTable { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
#roundTable th { text-align: right; color: var(--muted); font-weight: 500; font-size: .8rem; padding-bottom: 6px; }
#roundTable th:first-child { text-align: left; }
#roundTable td { padding: 9px 0; border-bottom: 1px solid var(--edge); }
#roundTable td.delta, #roundTable td.total { text-align: right; font-family: var(--deck); width: 5ch; }
#roundTable td.delta { color: var(--success); } #roundTable td.delta.dash { color: var(--muted); } #roundTable td.total { color: var(--gold); font-size: 1.15rem; }
#roundTable tr { animation: row-in 200ms var(--move) both; animation-delay: calc(var(--i, 0) * 70ms); }
@keyframes row-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
#nextRoundBtn { width: 100%; min-height: 52px; overflow: hidden; }
#nextRoundBtn .track { position: absolute; left: 0; bottom: 0; height: 3px; background: rgba(0,0,0,.35); width: calc(var(--p, 0) * 100%); transition: width 250ms linear; }

/* ---------- landing / lobby / results ---------- */
.landing .hero { display: flex; justify-content: center; margin: 10px 0 18px; height: 90px; }
.landing .fan { position: absolute; transform: rotate(calc((var(--i) - 3) * 9deg)) translateY(calc(abs(var(--i) - 3) * 4px)); }
.landing .hero { position: relative; } .landing .hero .fan:nth-child(1) { --i: 0 } .landing .hero .fan:nth-child(2) { --i: 1 } .landing .hero .fan:nth-child(3) { --i: 2 } .landing .hero .fan:nth-child(4) { --i: 3 } .landing .hero .fan:nth-child(5) { --i: 4 } .landing .hero .fan:nth-child(6) { --i: 5 } .landing .hero .fan:nth-child(7) { --i: 6 }
.lede { max-width: 34ch; color: var(--muted); font-size: 1.05rem; }
.panel { padding: 16px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--edge); margin-bottom: 14px; }
.panel button { width: 100%; }
.secondary { display: grid; gap: 10px; margin-bottom: 18px; }
.join-form { display: flex; gap: 10px; } .join-form input { margin-top: 0; width: 12ch; flex: 0 0 auto; font-family: var(--deck); font-size: 1.1rem; letter-spacing: .2em; text-transform: lowercase; }
.foot-links { color: var(--muted); font-size: .875rem; }
.code-inline { font-family: var(--deck); letter-spacing: .2em; color: var(--gold); }
.code-big { width: 100%; display: grid; justify-items: center; gap: 2px; padding: 14px; margin-bottom: 10px; }
.code-big .code-inline { font-size: 2.4rem; font-weight: 800; } .code-big .code-label, .code-big .code-hint { color: var(--muted); font-size: .8rem; }
.felt-panel { padding: 14px; border-radius: 16px; background: radial-gradient(120% 80% at 50% 20%, var(--felt-light), var(--felt)); border: 1px solid var(--edge); margin-bottom: 16px; }
.seat-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.seat-list .seat { display: flex; align-items: center; gap: 8px; min-height: 52px; }
.seat-list .seat.open { border-style: dashed; color: var(--muted); justify-content: center; }
.seat-list .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--success); }
.seat-list .offline .dot { background: var(--edge); }
.badge { padding: 1px 7px; border-radius: 6px; border: 1px solid var(--edge); color: var(--muted); font-size: .72rem; font-weight: 600; }
.badge.agent { border-color: var(--cyan); color: var(--cyan); } .badge.you { border-color: var(--gold); color: var(--gold); }
.badge.bot::before { content: "⚙ "; }
button.link { min-height: 0; padding: 2px 6px; margin-left: auto; border: 0; background: none; color: var(--muted); font-size: .8rem; text-decoration: underline; }
.results .winner { text-align: center; padding: 24px 0 8px; }
.results .fan { position: relative; height: 80px; margin-bottom: 8px; display: flex; justify-content: center; }
.results .fan .playing-card { position: absolute; animation: fan-in 700ms var(--snap) both; animation-delay: calc(var(--i) * 60ms); transform: rotate(calc((var(--i) - 3) * 10deg)) translateY(calc(abs(var(--i) - 3) * 5px)); }
@keyframes fan-in { from { transform: translateY(40px); opacity: 0; } }
#winnerLine { color: var(--gold); font-size: 2.4rem; } .final-score { font-family: var(--deck); font-size: 2rem; margin: 0 0 18px; }
#standings { margin: 0 0 22px; padding: 0; list-style: none; display: grid; gap: 6px; }
#standings li { display: flex; gap: 10px; padding: 8px 12px; border-radius: 8px; background: var(--surface); }
#standings li .place { font-family: var(--deck); color: var(--muted); width: 2ch; } #standings li .score { margin-left: auto; font-family: var(--deck); } #standings li .last { color: var(--muted); font-size: .85rem; }
.rules { margin: 0 0 20px; padding-left: 1.3em; display: grid; gap: 12px; max-width: 62ch; }
.rules li::marker { color: var(--gold); font-family: var(--deck); font-weight: 700; } .rules b { color: var(--gold); }
.hint { color: var(--muted); font-size: .9375rem; } .error { color: var(--danger); font-size: .875rem; }
.toast { position: fixed; left: 50%; z-index: 60; bottom: calc(90px + env(safe-area-inset-bottom)); transform: translateX(-50%); max-width: calc(100vw - 32px); padding: 11px 16px; border: 1px solid var(--edge); border-radius: 999px; background: var(--rail); box-shadow: 0 10px 24px rgba(0,0,0,.5); font-size: .9375rem; text-align: center; }

/* ---------- narrow: 360px ---------- */
@media (max-width: 400px) {
  :root { --card-w: 42px; --card-h: 59px; }
  .your-rail .hand { gap: 0; } .your-rail .hand .playing-card { margin-right: -8px; } .your-rail .hand .playing-card:last-of-type { margin-right: 0; }
  .playing-card b { font-size: 28px; }
  h1 { font-size: 2.8rem; }
}
/* ---------- desktop: oval table. Opponents 1-3 across the top, 4 and 5 at the
   sides of the draw zone, your rail across the bottom. Same DOM: `.seats`
   becomes display: contents so each seat is placed by the table grid. ---------- */
@media (min-width: 760px) {
  .view.table { max-width: 1120px; display: grid; grid-template-columns: 1fr minmax(320px, 420px) 1fr; grid-template-areas: "strip strip strip" "s1 s2 s3" "s4 draw s5" "rail rail rail" "log log log"; column-gap: 20px; row-gap: 12px; align-items: start; }
  .turn-strip { grid-area: strip; margin: 0; }
  .seats { display: contents; }
  .seats .seat:nth-child(1) { grid-area: s1; } .seats .seat:nth-child(2) { grid-area: s2; } .seats .seat:nth-child(3) { grid-area: s3; }
  .seats .seat:nth-child(4) { grid-area: s4; align-self: center; } .seats .seat:nth-child(5) { grid-area: s5; align-self: center; }
  .draw-zone { grid-area: draw; margin: 24px 0; align-self: center; } .your-rail { grid-area: rail; } .log { grid-area: log; }
  .controls, .target-picker { position: sticky; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
  .playing-card.new, .playing-card.reveal.emph { animation: emphasis 120ms ease both !important; animation-duration: 120ms !important; }
  .playing-card.reveal { transition: none; }
}
```

- [ ] **Step 3: Verify the shell serves**

Run the server on a free port and load the landing page in Chrome; confirm the Barlow font loads (Network tab shows the Google Fonts CSS) and the hero fan renders; the table view is unstyled-but-present (table.js is rewritten next). `npm test` still green.

```bash
PORT=3017 node server.js
```

Stop the server afterwards (find the PID on port 3017 with `netstat -ano | grep :3017` and stop it).

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/styles.css
git commit -m "New shell markup and felt-table stylesheet"
```

---

### Task 7: `table.js` keyed reconciler, controls, pending state, and `app.js` wiring

**Files:**
- Rewrite: `public/js/table.js`
- Modify: `public/js/app.js`, `public/js/lobby.js`, `public/js/results.js`
- Create: `public/js/effects.js` (skeleton: `render`, `preRender`, `caption`, view switching; step effects come in Tasks 8 and 9)

**Interfaces:**
- Consumes: `createPresenter` (Task 5), DOM ids from Task 6.
- Produces `table.js` exports:
  - `mount(ctx)` — binds Hit/Stay once; `ctx = { send, toast, copyLink }`.
  - `render(state, ctx)` — full reconcile with controls enabled.
  - `preRender(state, ctx)` — countdown, turn strip, and controls shown but disabled with label `Finishing reveal…` when the decision is yours.
  - `stop()` — clears the countdown interval.
  - `clearPending()` — re-enables controls if a pending press is stuck (called by app.js on reconnect and on error).
  - DOM helpers for effects.js: `seatEl(id)`, `handEl(id)`, `cardEl(id, key)`, `deckEl()`, `discardEl()`, `parkedEl()`, `addCard(id, card)` (inserts a keyed card in sorted position and returns it), `clearHand(id)`, `setDiscardTop(card)`, `setStatus(id, status)`, `setRoundScore(id, n)`, `setShield(id, on)`, `setPips(id, n)` (`n = 0` hides), `keyFor(card, ordinal)`, `makeCard(card, size)`.
  - `renderSheet(state, ctx)` / `hideSheet()`; `renderResults(state, ctx)` (moves the results rendering from `results.js` into table.js and deletes `results.js`).
- Card keys: numbers `n:<value>`; modifiers `m:<value>:<ordinal>` where ordinal counts equal modifiers in that hand.
- `effects.js` skeleton exports `createEffects({ table, ctx, views })` returning the presenter's effects object: `render(state)` switches to the table view when `state.game.phase === "round"`, shows the sheet on `round_over`, shows results on `game_over`, and calls `table.render`; `preRender(state)` calls `table.preRender`; `caption(text)` writes `#caption`; `begin/end` are `noop` for now.

- [ ] **Step 1: Write `public/js/table.js`**

```js
import { renderLog } from "./log.js";
import { cardKind } from "./sequence.js";
const $ = (id) => document.getElementById(id);
const LABEL = { freeze: "Freeze", flip_three: "Flip 3", second_chance: "2nd Chance" };
const ARIA = (card) => typeof card === "number" ? `number ${card}` : card === "x2" ? "times 2" : card.startsWith("+") ? `plus ${card.slice(1)}` : (LABEL[card] || card);
const GLYPH = {
  freeze: '<svg viewBox="0 0 24 24"><path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19"/></svg>',
  flip_three: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="8" height="11" rx="1"/><rect x="8" y="7" width="8" height="11" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/></svg>',
  second_chance: '<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/></svg>',
};
let countdown = null, pending = null, mounted = false;

export function keyFor(card, ordinal = 0) { return typeof card === "number" ? `n:${card}` : `m:${card}:${ordinal}`; }
export function makeCard(card, size = "") {
  const el = document.createElement("span");
  const kind = cardKind(card);
  el.className = `playing-card ${kind} ${size}`.trim();
  el.setAttribute("aria-label", ARIA(card));
  if (kind === "number") el.innerHTML = `<b>${card}</b><i class="idx">${card}</i><i class="notches"></i>`;
  else if (kind === "modifier") el.innerHTML = `<b>${card === "x2" ? "×2" : card}</b>`;
  else el.innerHTML = `${GLYPH[card] || ""}<b>${LABEL[card] || card}</b>`;
  return el;
}

export function stop() { clearInterval(countdown); countdown = null; pending = null; }
// Called on a newer turn, on reconnect, and on any server error: a lost action
// must never leave the controls or the target picker dead.
export function clearPending() {
  pending = null;
  for (const b of [$("hitBtn"), $("stayBtn")]) { b.disabled = false; b.style.width = ""; b.querySelector(".spinner").hidden = true; }
  $("hitBtn").querySelector(".label").textContent = "Hit"; $("stayBtn").querySelector(".label").textContent = "Stay";
  for (const b of $("targetPicker").querySelectorAll("button")) { b.disabled = false; b.classList.remove("pending"); }
}

export function mount(ctx) {
  if (mounted) return; mounted = true;
  const press = (action, label) => {
    const g = mount.state && mount.state.game; if (!g || pending) return;
    pending = { turnNumber: g.turnNumber };
    ctx.send({ type: "act", turnNumber: g.turnNumber, action });
    const btn = action === "hit" ? $("hitBtn") : $("stayBtn");
    for (const b of [$("hitBtn"), $("stayBtn")]) { b.style.width = `${b.getBoundingClientRect().width}px`; b.disabled = true; }
    btn.querySelector(".label").textContent = label; btn.querySelector(".spinner").hidden = false;
  };
  $("hitBtn").onclick = () => press("hit", "Flipping…");
  $("stayBtn").onclick = () => press("stay", "Staying…");
}

// ---- element lookups used by effects.js ----
export const seatEl = (id) => document.querySelector(`.seat[data-player="${id}"]`);
export const handEl = (id) => seatEl(id)?.querySelector(".hand");
export const cardEl = (id, key) => handEl(id)?.querySelector(`.playing-card[data-key="${key}"]`);
export const deckEl = () => $("deck");
export const discardEl = () => $("discard");
export const parkedEl = () => $("parked");
export function setDiscardTop(card) { const top = $("discardTop"); top.textContent = ""; if (card !== null && card !== undefined) top.appendChild(makeCard(card, "sm")); }
export function setStatus(id, status) { const el = seatEl(id); if (!el) return; el.className = el.className.replace(/status-\w+/, `status-${status}`); el.querySelector(".hand").classList.toggle("frozen", status === "frozen"); }
export function setRoundScore(id, n) { const el = seatEl(id)?.querySelector(".round-score"); if (el) el.textContent = String(n); }
export function setShield(id, on) { const el = seatEl(id)?.querySelector(".shield"); if (el) el.hidden = !on; }
export function setPips(id, n) { const el = seatEl(id)?.querySelector(".pips"); if (!el) return; el.hidden = n <= 0; el.querySelectorAll("i").forEach((i, k) => { i.hidden = k >= n; }); }
export function clearHand(id) { const h = handEl(id); if (!h) return; for (const c of h.querySelectorAll(".playing-card")) c.remove(); }
export function addCard(id, card) {
  const h = handEl(id); if (!h) return null;
  const size = seatEl(id).closest(".your-rail") ? "" : "sm";
  const kind = cardKind(card);
  if (kind === "action") return null;
  const existing = [...h.querySelectorAll(".playing-card")];
  const ordinal = kind === "modifier" ? existing.filter((c) => c.dataset.key.startsWith(`m:${card}:`)).length : 0;
  const key = keyFor(card, ordinal);
  if (h.querySelector(`[data-key="${key}"]`)) return h.querySelector(`[data-key="${key}"]`);
  const el = makeCard(card, size); el.dataset.key = key;
  let before = null;
  if (kind === "number") before = existing.find((c) => c.dataset.key.startsWith("n:") && Number(c.dataset.key.slice(2)) > card) || existing.find((c) => c.dataset.key.startsWith("m:")) || h.querySelector(".shield");
  else before = h.querySelector(".shield");
  h.insertBefore(el, before);
  refreshNotches(id);
  return el;
}
function refreshNotches(id) { const h = handEl(id); if (!h) return; const n = h.querySelectorAll(".playing-card.number").length; for (const c of h.querySelectorAll(".playing-card.number .notches")) c.style.setProperty("--n", n); }

// ---- reconcile ----
function reconcileHand(h, p, size) {
  const want = [...p.numbers.map((n) => ({ card: n, key: keyFor(n) })), ...p.modifiers.map((m, i, arr) => ({ card: m, key: keyFor(m, arr.slice(0, i).filter((x) => x === m).length) }))];
  const have = new Map([...h.querySelectorAll(".playing-card")].map((c) => [c.dataset.key, c]));
  for (const [k, c] of have) if (!want.some((w) => w.key === k)) c.remove();
  let anchor = h.querySelector(".shield");
  for (let i = want.length - 1; i >= 0; i--) {
    let el = have.get(want[i].key);
    if (!el) { el = makeCard(want[i].card, size); el.dataset.key = want[i].key; }
    if (el.nextSibling !== anchor) h.insertBefore(el, anchor);
    anchor = el;
  }
  h.querySelector(".shield").hidden = !p.second_chance;
  const n = p.numbers.length; for (const c of h.querySelectorAll(".notches")) c.style.setProperty("--n", n);
}
function ensureSeat(container, p) {
  let li = container.querySelector(`.seat[data-player="${p.id}"]`);
  if (!li) {
    li = document.createElement("li"); li.dataset.player = p.id;
    li.innerHTML = `<div class="seat-head"><span class="name"></span><span class="dealer" title="dealer" hidden>D</span><span class="status-glyph"></span><span class="banked"></span></div><div class="hand"><span class="shield" hidden aria-label="holds a Second Chance"></span><span class="pips" hidden><i></i><i></i><i></i></span></div><div class="seat-foot"><span class="round-score"></span><span class="stamp" hidden>BANKED</span></div>`;
    container.appendChild(li);
  }
  return li;
}
export function render(state, ctx) { mount.state = state; paint(state, ctx, true); }
export function preRender(state, ctx) { mount.state = state; paint(state, ctx, false); }

function paint(state, ctx, settled) {
  const g = state.game; if (!g) return;
  const nameOf = (id) => (g.players.find((p) => p.id === id) || { name: id }).name;
  // turn strip + countdown
  const strip = document.querySelector(".turn-strip");
  strip.classList.toggle("mine", g.current_player === state.you && g.phase === "round");
  $("turnWho").textContent = g.phase === "round" ? (g.current_player === state.you ? "Your decision" : `${nameOf(g.current_player)} is deciding`) : g.phase === "round_over" ? "Round over" : "";
  clearInterval(countdown); const cd = $("countdown");
  if (state.timer && g.phase === "round") {
    cd.hidden = false; let remaining = state.timer.remainingMs; const total = state.timer.totalMs || 30000;
    const tick = () => { const s = Math.ceil(Math.max(0, remaining) / 1000); $("countNum").textContent = s; cd.style.setProperty("--p", Math.max(0, remaining) / total); cd.classList.toggle("warn", s <= 6 && s > 4); cd.classList.toggle("hot", s <= 4 && s > 2); cd.classList.toggle("crit", s <= 2); remaining -= 250; };
    tick(); countdown = setInterval(tick, 250);
  } else cd.hidden = true;
  // seats (only on settled renders: a pre-render must not jump the hands ahead of the animation)
  if (settled) {
    const seats = $("seats"), rail = $("yourRail");
    for (const p of g.players) {
      const mine = p.id === state.you;
      const li = ensureSeat(mine ? rail : seats, p);
      li.className = `seat status-${p.status}` + (p.id === g.current_player ? " current" : "") + (mine ? " you" : "");
      li.querySelector(".name").textContent = p.name;
      li.querySelector(".dealer").hidden = p.id !== g.dealer;
      li.querySelector(".banked").textContent = String(p.score);
      li.querySelector(".round-score").textContent = String(p.round_score);
      li.querySelector(".hand").classList.toggle("frozen", p.status === "frozen");
      reconcileHand(li.querySelector(".hand"), p, mine ? "" : "sm");
      setPips(p.id, 0);
    }
    for (const li of seats.querySelectorAll(".seat")) if (!g.players.some((p) => p.id === li.dataset.player)) li.remove();
    $("deckCount").textContent = String(g.deck_remaining);
    setDiscardTop(g.discard.length ? g.discard.at(-1) : null);
    // Open Flip Three frames are authoritative state: their set-aside cards stay parked
    // and their pips stay lit across snapshots (a target decision can interrupt a frame).
    $("parked").textContent = "";
    for (const f of g.resolution) {
      if (f.card === "flip_three" && f.target && !f.ended && f.remaining > 0) setPips(f.target, f.remaining);
      for (const c of f.setAside) { const el = makeCard(c, "sm"); el.dataset.player = f.target; $("parked").appendChild(el); }
    }
    $("fxLayer").textContent = "";
  }
  // controls
  const mine = g.decision && g.current_player === state.you ? g.decision : null;
  if (pending && g.turnNumber > pending.turnNumber) clearPending();
  const hs = mine && mine.type === "hit_or_stay";
  $("controls").hidden = !hs; $("targetPicker").hidden = !(mine && mine.type === "choose_target");
  if (hs) {
    const wait = !settled && !pending;
    for (const b of [$("hitBtn"), $("stayBtn")]) b.disabled = wait || !!pending;
    if (!pending) { $("hitBtn").querySelector(".label").textContent = wait ? "Finishing reveal…" : "Hit"; $("stayBtn").querySelector(".label").textContent = "Stay"; if (!wait) { $("hitBtn").style.width = ""; $("stayBtn").style.width = ""; } }
    if (settled && !pending && document.activeElement !== $("stayBtn")) { $("hitBtn").focus({ preventScroll: true }); $("hitBtn").classList.remove("pulse"); void $("hitBtn").offsetWidth; $("hitBtn").classList.add("pulse"); }
  }
  if (mine && mine.type === "choose_target") {
    const picker = $("targetPicker"); picker.textContent = "";
    const h = document.createElement("p"); h.textContent = `Give ${LABEL[mine.card]} to:`; picker.appendChild(h);
    mine.candidates.forEach((id, i) => {
      const p = g.players.find((q) => q.id === id);
      const b = document.createElement("button"); b.className = "big"; b.disabled = !settled || !!pending;
      b.innerHTML = `<span class="label"></span><span class="spinner" hidden></span>`;
      b.querySelector(".label").textContent = `${p.name}${id === state.you ? " (you)" : ""} · ${p.score + p.round_score}`;
      b.onclick = () => { if (pending) return; pending = { turnNumber: g.turnNumber }; for (const x of picker.querySelectorAll("button")) x.disabled = true; b.classList.add("pending"); b.querySelector(".spinner").hidden = false; ctx.send({ type: "act", turnNumber: g.turnNumber, action: "target:" + id }); };
      picker.appendChild(b); if (i === 0 && settled) b.focus({ preventScroll: true });
    });
  }
  if (settled) renderLog(g, nameOf);
}

// ---- summary sheet and results ----
let sheetTimer = null;
export function renderSheet(state, ctx) {
  const s = state.roundSummary; if (!s) return;
  $("summarySheet").hidden = false;
  $("roundTitle").textContent = state.game.phase === "game_over" ? `Final round ${s.round}` : `Round ${s.round} over`;
  const tb = $("roundTable").querySelector("tbody"); tb.textContent = "";
  s.rows.forEach((row, i) => {
    const tr = document.createElement("tr"); tr.style.setProperty("--i", i);
    const busted = row.status === "busted";
    tr.innerHTML = `<td class="name"></td><td class="delta${busted ? " dash" : ""}"></td><td class="total"></td>`;
    tr.querySelector(".name").textContent = row.name + (row.flip7 ? " · Flip 7!" : "");
    tr.querySelector(".delta").textContent = busted ? "—" : `+${row.roundScore}`;
    tr.querySelector(".total").textContent = String(row.score);
    tb.appendChild(tr);
  });
  const next = $("nextRoundBtn"); next.hidden = state.game.phase === "game_over";
  next.onclick = () => ctx.send({ type: "next-round", roundNumber: s.round });
  clearInterval(sheetTimer);
  if (state.summaryTimer) { let left = state.summaryTimer.remainingMs; const total = state.summaryTimer.totalMs || 8000; const tick = () => { $("nextTrack").style.setProperty("--p", 1 - Math.max(0, left) / total); left -= 250; }; tick(); sheetTimer = setInterval(tick, 250); }
}
export function hideSheet() { $("summarySheet").hidden = true; clearInterval(sheetTimer); }
export function renderResults(state, ctx) {
  const r = state.results; if (!r) return;
  $("winnerLine").textContent = `${r.winnerName} wins`;
  const win = r.standings.find((s) => s.id === r.winner); $("winnerScore").textContent = win ? String(win.score) : "";
  const fan = $("winnerFan"); fan.textContent = "";
  [3, 5, 7, 9, 11, 12, 0].forEach((n, i) => { const c = makeCard(n, "sm"); c.style.setProperty("--i", i); fan.appendChild(c); });
  const last = new Map((state.roundSummary?.rows || []).map((row) => [row.id, row.roundScore]));
  const ol = $("standings"); ol.textContent = "";
  r.standings.forEach((s, i) => { const li = document.createElement("li"); li.innerHTML = `<span class="place"></span><span class="name"></span><span class="last"></span><span class="score"></span>`; li.querySelector(".place").textContent = String(i + 1); li.querySelector(".name").textContent = s.name; li.querySelector(".last").textContent = last.has(s.id) ? `last round +${last.get(s.id)}` : ""; li.querySelector(".score").textContent = String(s.score); ol.appendChild(li); });
  $("playAgainBtn").onclick = () => ctx.send({ type: "return-to-lobby" });
  $("resultsCopyLinkBtn").onclick = ctx.copyLink;
}
```

- [ ] **Step 2: Write the `effects.js` skeleton**

```js
// DOM effects for the presentation queue. `render` and `preRender` reconcile;
// step handlers (Tasks 8 and 9) animate between them.
import * as table from "./table.js";
const $ = (id) => document.getElementById(id);

export function createEffects({ ctx, showView }) {
  const handlers = { begin: {}, end: {} };
  function caption(text, tone = "") { const c = $("caption"); c.textContent = text || ""; c.className = `caption ${tone}`.trim(); $("live").textContent = text || ""; }
  // Built as a named object so Tasks 8 and 9 can add step handlers and wrap `render` before it is returned.
  const api = {
    handlers, caption,
    render(state) {
      if (!state.game) return;
      const ph = state.game.phase;
      showView("tableView");
      table.render(state, ctx);
      if (ph === "round_over") table.renderSheet(state, ctx);
      else if (ph === "game_over") { table.hideSheet(); showView("resultsView"); table.renderResults(state, ctx); }
      else table.hideSheet();
    },
    preRender(state) { table.preRender(state, ctx); },
    begin(step) { if (step.caption) caption(step.caption, step.kind === "pair" && /BUST/.test(step.caption) ? "loud" : /FLIP 7|SECOND CHANCE/.test(step.caption || "") ? "gold" : ""); (handlers.begin[step.kind] || (() => {}))(step); },
    end(step) { (handlers.end[step.kind] || (() => {}))(step); },
  };
  // Tasks 8 and 9 insert their handler definitions here, before the return.
  return api;
}
```

- [ ] **Step 3: Rewire `app.js`**

Replace the imports and the game branch of `render()`; create the presenter once per room:

```js
import { createNet, readName, writeName, readToken, clearToken } from "./net.js";
import * as landing from "./landing.js";
import * as lobby from "./lobby.js";
import * as table from "./table.js";
import { createPresenter } from "./present.js";
import { createEffects } from "./effects.js";
```

`showView(id)` no longer touches the round overlay:

```js
export function showView(id) { for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== id; }
```

In `leaveRoom()` add `if (presenter) { presenter.reset(); presenter = null; } table.hideSheet();` and declare `let presenter = null;` with the other module state.

In `enterRoom()`, after `you = null; state = null;` add:

```js
  const ctx = { send: (o) => net && net.send(o), toast, room: code, copyLink };
  table.mount(ctx);
  presenter = createPresenter({ effects: createEffects({ ctx, showView }), reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches });
```

(`table.mount` reads `ctx.send` lazily through the closure, so creating it before `net` exists is fine.) In `createNet`'s options: `onConnection: (ok) => { $("connPill").hidden = ok; live(ok ? "connected" : "reconnecting"); if (ok) table.clearPending(); }` and in `onError`, before the `seat_taken_over` line, add `table.clearPending();`.

Replace `render()`:

```js
function render() {
  if (!state) return;
  if (state.you === null) { if ($("joinView").hidden) showJoin(); return; }
  you = state.you;
  const ctx = { send: (o) => net.send(o), you, toast, room, copyLink };
  if (state.phase === "lobby" || !state.game) { presenter.enqueue(state); showView("lobbyView"); lobby.render(state, ctx); return; }
  presenter.enqueue(state);
  if (state.game.decision && state.game.turnNumber !== lastTurnRendered) { lastTurnRendered = state.game.turnNumber; live("Your turn"); }
}
```

Delete `public/js/results.js` and the `results` import. In `lobby.js`, render six slots: seated players as now (bot badge gets class `badge bot`), then `6 - seats.length` `<li class="seat open">Open seat</li>` items. `copyLinkBtn` binding unchanged.

- [ ] **Step 4: Verify in Chrome and commit**

Start the server on a free port, quick-play in Chrome: the table renders in the new layout, your rail at the bottom with 50×70 cards, opponents in the two-column grid, deck count and discard top update, Hit/Stay work, pressing Hit shows `Flipping…` with the spinner until the next state, the round sheet appears at round end and the results view at game over. Run `npm test` (green). Stop the server.

```bash
git add public/js/table.js public/js/effects.js public/js/app.js public/js/lobby.js
git rm public/js/results.js
git commit -m "Keyed table reconciler, presenter wiring, pending controls, sheet and results"
```

---

### Task 8: Effects — reveal flight, hit, bust, Second Chance

**Files:**
- Modify: `public/js/effects.js`

**Interfaces:**
- Consumes: table helpers from Task 7; step kinds from Task 3.
- Implements `handlers.begin/end` for: `press-deck`, `travel`, `flip`, `rest`, `sort`, `hold`, `to-discard`, `to-token`, `park`, `beat`, `score-roll`, `pair`, `shake`, `sweep`, `shield-flash`, `token-land`, `token-arc`, `caption`, `round-start`, `reshuffle`.
- The transient reveal card lives in `#fxLayer`; one per player at a time, kept in a `Map` `flying` (player → element). Flight endpoints come from `getBoundingClientRect()`.

- [ ] **Step 1: Add the reveal helpers and handlers**

Inside `createEffects`, after the `const api = { ... };` object and before `return api;`, add:

```js
  const flying = new Map();
  const rect = (el) => el.getBoundingClientRect();
  const place = (el, r) => { el.style.setProperty("--x", `${r.left + (r.width - el.offsetWidth) / 2}px`); el.style.setProperty("--y", `${r.top + (r.height - el.offsetHeight) / 2}px`); };
  const handTarget = (id) => { const h = table.handEl(id); const cards = h ? h.querySelectorAll(".playing-card") : []; const last = cards[cards.length - 1]; if (last) { const r = rect(last); return { left: r.right + 4, top: r.top, width: r.width, height: r.height }; } return h ? rect(h) : rect(table.deckEl()); };
  function spawn(step) {
    const el = table.makeCard(step.card, "reveal"); el.classList.add("reveal", "back"); el.dataset.face = "back";
    el.style.setProperty("--dur", "0ms"); $("fxLayer").appendChild(el); place(el, rect(table.deckEl()));
    void el.offsetWidth; flying.set(step.player, el); return el;
  }
  const H = handlers.begin, E = handlers.end;
  // table.render empties #fxLayer, so a capped barrier must not leave detached
  // reveal cards in the map: wrap render to clear it.
  const baseRender = api.render; api.render = (state) => { flying.clear(); baseRender(state); };
  H["press-deck"] = () => table.deckEl().classList.add("press");
  E["press-deck"] = () => table.deckEl().classList.remove("press");
  H.travel = (s) => { const el = flying.get(s.player) || spawn(s); el.style.setProperty("--dur", `${s.ms}ms`); place(el, handTarget(s.player)); };
  H.flip = (s) => { const el = flying.get(s.player); if (!el) return; el.classList.add("flipping"); el.style.setProperty("--dur", `${Math.max(1, s.ms / 2)}ms`); el.style.setProperty("--ry", "90deg");
    setTimeout(() => { el.classList.remove("back"); el.dataset.face = "front"; el.style.setProperty("--ry", "0deg"); }, Math.max(1, s.ms / 2)); };
  E.flip = (s) => { const el = flying.get(s.player); if (el) { el.classList.remove("flipping", "back"); el.style.setProperty("--ry", "0deg"); } };
  H.sort = (s) => { const el = flying.get(s.player); const real = table.addCard(s.player, s.card); if (real && el) { real.classList.add("new"); place(el, rect(real)); el.style.setProperty("--dur", `${s.ms}ms`); } };
  E.sort = (s) => { const el = flying.get(s.player); if (el) { el.remove(); flying.delete(s.player); } const real = table.handEl(s.player)?.querySelector(".playing-card.new"); if (real) real.classList.remove("new"); };
  H["to-discard"] = (s) => { const el = flying.get(s.player); if (el) { el.style.setProperty("--dur", `${s.ms}ms`); place(el, rect(table.discardEl())); } const twin = table.cardEl(s.player, table.keyFor(s.card)); if (s.shield) { table.setShield(s.player, false); if (twin) twin.classList.remove("dup"); } };
  E["to-discard"] = (s) => { const el = flying.get(s.player); if (el) { el.remove(); flying.delete(s.player); } table.setDiscardTop(s.card); };
  H.park = (s) => { const el = flying.get(s.player); if (el) { el.style.setProperty("--dur", `${s.ms}ms`); place(el, rect(table.parkedEl().parentElement)); } };
  E.park = (s) => { const el = flying.get(s.player); if (el) { el.remove(); flying.delete(s.player); } const c = table.makeCard(s.card, "sm"); c.dataset.player = s.player; table.parkedEl().appendChild(c); };
  H["score-roll"] = (s) => { const el = table.seatEl(s.player)?.querySelector(".round-score"); if (el) { el.classList.remove("roll"); void el.offsetWidth; el.classList.add("roll"); const p = latestPlayer(s.player); if (p) el.textContent = String(p.round_score); } };
  H.pair = (s) => { const el = flying.get(s.player); const twin = table.cardEl(s.player, table.keyFor(s.card)); if (twin) { twin.classList.add("dup"); if (el) { el.classList.add("dup"); const r = rect(twin); place(el, { left: r.right + 6, top: r.top, width: r.width, height: r.height }); el.style.setProperty("--dur", "160ms"); } } };
  H.shake = (s) => { const li = table.seatEl(s.player); if (li) { li.classList.remove("shake"); void li.offsetWidth; li.classList.add("shake"); } };
  E.shake = (s) => table.seatEl(s.player)?.classList.remove("shake");
  H.sweep = (s) => { const h = table.handEl(s.player); const el = flying.get(s.player); const d = rect(table.discardEl());
    if (h) { const hr = rect(h); h.style.setProperty("--sx", `${d.left - hr.left}px`); h.style.setProperty("--sy", `${d.top - hr.top}px`); h.classList.add("sweeping"); }
    if (el) { el.style.setProperty("--dur", `${s.ms}ms`); place(el, d); }
    for (const c of table.parkedEl().querySelectorAll(`[data-player="${s.player}"]`)) c.remove(); };
  E.sweep = (s) => { const h = table.handEl(s.player); if (h) { h.classList.remove("sweeping"); table.clearHand(s.player); } const el = flying.get(s.player); if (el) { el.remove(); flying.delete(s.player); } table.setStatus(s.player, "busted"); table.setRoundScore(s.player, 0); table.setDiscardTop(s.card ?? null); };
  H["shield-flash"] = (s) => { const sh = table.seatEl(s.player)?.querySelector(".shield"); if (sh) { sh.hidden = false; sh.classList.remove("flash"); void sh.offsetWidth; sh.classList.add("flash"); } };
  // A kept Second Chance never touches the discard: the flying card shrinks into the shield token.
  H["to-token"] = (s) => { const el = flying.get(s.player); const sh = table.seatEl(s.player)?.querySelector(".shield"); if (el) { el.style.setProperty("--dur", `${s.ms}ms`); if (sh) { sh.hidden = false; place(el, rect(sh)); } el.style.opacity = "0"; el.style.transition += ", opacity " + s.ms + "ms"; } };
  E["to-token"] = (s) => { const el = flying.get(s.player); if (el) { el.remove(); flying.delete(s.player); } };
  H["token-land"] = (s) => { table.setShield(s.player, true); const sh = table.seatEl(s.player)?.querySelector(".shield"); if (sh) { sh.classList.remove("flash"); void sh.offsetWidth; sh.classList.add("flash"); } };
  E["token-land"] = (s) => table.seatEl(s.player)?.querySelector(".shield")?.classList.remove("flash");
  // The given card is the giver's *second* Second Chance: it arcs from the discard, and the giver keeps their own shield.
  H["token-arc"] = (s) => { const to = table.seatEl(s.to); if (!to) return; const tok = document.createElement("span"); tok.className = "shield reveal-token"; tok.style.position = "fixed"; tok.style.zIndex = 41; tok.style.transition = `transform ${s.ms}ms var(--move)`; const a = rect(table.discardEl()); const b = rect(to.querySelector(".hand")); tok.style.left = `${a.left}px`; tok.style.top = `${a.top}px`; $("fxLayer").appendChild(tok); void tok.offsetWidth; tok.style.transform = `translate(${b.right - 26 - a.left}px, ${b.top - a.top}px)`; };
  E["token-arc"] = (s) => { for (const t of $("fxLayer").querySelectorAll(".reveal-token")) t.remove(); table.setShield(s.to, true); };
  H.caption = () => {};
  H["round-start"] = () => { table.hideSheet(); for (const el of flying.values()) el.remove(); flying.clear(); $("parked").textContent = ""; };
  H.reshuffle = () => { const top = $("discardTop"); top.style.transition = "transform 300ms var(--move), opacity 300ms"; const d = rect(table.discardEl()), k = rect(table.deckEl()); top.style.transform = `translate(${k.left - d.left}px, ${k.top - d.top}px)`; top.style.opacity = "0"; };
  E.reshuffle = () => { const top = $("discardTop"); top.style.transition = ""; top.style.transform = ""; top.style.opacity = ""; table.setDiscardTop(null); };
  function latestPlayer(id) { const st = table.mount.state; return st && st.game ? st.game.players.find((p) => p.id === id) : null; }
```

Note for `rest`, `hold`, `beat`: no handler is needed; the queue simply waits.

`score-roll` reads the round score from the latest snapshot: acceptable because a modifier never changes another player's score and the latest snapshot is at least as new as the step. The planner's `sweep` step already carries `card` (the bust card), which `E.sweep` puts on the discard. Under reduced motion the planner gives `flip` 120 ms and zeroes the rest: in `H.flip`, when `s.ms <= 120`, skip the rotateY and instead add the class `emph` to the reveal card (the 120 ms colour emphasis) and swap to the face immediately.

- [ ] **Step 2: Verify in Chrome**

Quick play. Confirm: each hit spawns a card back on the deck that flies to the hand end, flips to its face, rests, then sorts into the hand while the transient fades. A bust (play until one happens; bots bust often) shows the duplicate landing beside its twin outlined red, the seat shakes, the caption `BUST · duplicate N` shows in danger red, then the whole hand sweeps into the discard and the seat shows `bust`. Second Chance: hold one (add bots and play a few rounds), bust into it: pair shows, shield flashes, duplicate and shield go to discard, hand stays. Verify that after a bust or any reveal the authoritative render leaves no `.reveal` element behind and hand cards match the log.

- [ ] **Step 3: Run tests and commit**

```bash
npm test
git add public/js/effects.js public/js/sequence.js
git commit -m "Reveal flight, bust pair and sweep, Second Chance effects"
```

---

### Task 9: Effects — Flip Three, Freeze, Stay, Flip 7, sheet, results, reduced motion

**Files:**
- Modify: `public/js/effects.js`

**Interfaces:**
- Implements `pips-set`, `pip-remove`, `pips-clear`, `freeze-sweep`, `banked-stamp`, `notches`, `flip7-ring`, `sheet`, `results`.
- Parked cards: `pips-clear` leaves parked cards in `#parked`; each subsequent consequence (`freeze-sweep`, `pips-set`, `token-land`) that names the same player as `from` removes the first parked card for that player at its `begin`.

- [ ] **Step 1: Add the handlers**

Inside `createEffects`:

```js
  const unpark = (id) => { const c = table.parkedEl().querySelector(`[data-player="${id}"]`); if (c) { table.setDiscardTop(cardOf(c)); c.remove(); } };
  const cardOf = (el) => { const b = el.querySelector("b")?.textContent || ""; return el.classList.contains("number") ? Number(b) : el.getAttribute("aria-label") === "Freeze" ? "freeze" : el.getAttribute("aria-label") === "Flip 3" ? "flip_three" : "second_chance"; };
  let pips = new Map();
  H["pips-set"] = (s) => { unpark(s.from); pips.set(s.player, 3); table.setPips(s.player, 3); };
  H["pip-remove"] = (s) => { const n = Math.max(0, (pips.get(s.player) || 0) - 1); pips.set(s.player, n); table.setPips(s.player, n); };
  H["pips-clear"] = (s) => { pips.delete(s.player); table.setPips(s.player, 0); };
  const prevFreeze = H["freeze-sweep"];
  H["freeze-sweep"] = (s) => { unpark(s.from); const h = table.handEl(s.to); if (h) { h.classList.remove("freeze-sweep"); void h.offsetWidth; h.classList.add("freeze-sweep"); } };
  E["freeze-sweep"] = (s) => { table.handEl(s.to)?.classList.remove("freeze-sweep"); table.setStatus(s.to, "frozen"); };
  const prevLand = H["token-land"];
  H["token-land"] = (s) => { unpark(s.player); prevLand(s); };
  H["banked-stamp"] = (s) => { const st = table.seatEl(s.player)?.querySelector(".stamp"); if (st) { st.hidden = false; } table.setStatus(s.player, "stayed"); };
  H.notches = (s) => { const h = table.handEl(s.player); if (!h) return; h.querySelectorAll(".notches").forEach((n) => { n.style.transition = "background 350ms linear"; n.style.setProperty("--n", 7); }); };
  H["flip7-ring"] = (s) => { const li = table.seatEl(s.player); if (li) { li.classList.remove("flip7"); void li.offsetWidth; li.classList.add("flip7"); } };
  E["flip7-ring"] = (s) => table.seatEl(s.player)?.classList.remove("flip7");
  H.sheet = () => { const st = table.mount.state; if (st) table.renderSheet(st, ctx); };
  H.results = () => { const st = table.mount.state; if (st && st.game.phase === "game_over") { table.hideSheet(); showView("resultsView"); table.renderResults(st, ctx); } };
```

Remove the `prevFreeze` line (there is no earlier freeze handler) — it is shown only to make the override pattern explicit for `token-land`.

`table.mount.state` is set by `preRender`, so at `sheet` time it holds the latest snapshot, which for `round_over` carries `roundSummary` (Task 1). For a `game_over` snapshot, `roundSummary` also exists, so the sheet shows the final round before `results` switches the view.

- [ ] **Step 2: Reduced motion**

Effects need no branch: with `reducedMotion` the planner zeroes travel/sort/sweep/etc. and keeps `flip` at 120 ms, so `H.travel` places the card instantly (0 ms transition), `H.flip` flips in 120 ms, and the CSS media query removes remaining animation. Verify in Chrome with DevTools → Rendering → "Emulate CSS prefers-reduced-motion: reduce": cards appear in place, the bust duplicate still holds beside its twin with the red outline for the full pair + hold time, captions still show.

- [ ] **Step 3: Verify Flip Three, Freeze, Flip 7 in Chrome**

Play with 3 bots until a Flip Three and a Freeze occur (they are common; a quick way is to keep hitting). Confirm three pips appear on the target, each card flies and flips one at a time with a visible pause, pips drop one per card, an action drawn mid-Flip-Three parks beside the discard with a dashed outline and resolves after the third card. Freeze: cyan sweep over the target hand, hand desaturates, status reads `❄ frozen`. Stay: `BANKED` stamp. Flip 7 (rare; alternatively verify the ring by temporarily triggering `H["flip7-ring"]({player: you})` from the console): notches light, gold ring expands, caption `FLIP 7 +15`. Round end: sheet slides up with staggered rows, busted players show `—`, Next round's progress track fills over 8 s. Game over: final-round sheet, then results with the seven-card fan and the deciding round's `last round +N` per standing.

- [ ] **Step 4: Run tests and commit**

```bash
npm test
git add public/js/effects.js
git commit -m "Flip Three, Freeze, Stay, Flip 7, sheet and results effects"
```

---

### Task 10: Landing, lobby, how-to-play polish and log captions

**Files:**
- Modify: `public/js/landing.js` (no logic change; confirm ids), `public/js/lobby.js`, `public/js/log.js`, `public/styles.css` (only if a screenshot shows a defect)

- [ ] **Step 1: Lobby open seats and bot gear**

In `lobby.js` `render`, after the seated loop:

```js
  for (let i = state.seats.length; i < 6; i++) { const li = document.createElement("li"); li.className = "seat open"; li.textContent = "Open seat"; list.appendChild(li); }
```

and give the bot badge the class `badge bot` (`'<span class="badge bot">bot</span>'`).

- [ ] **Step 2: Log captions**

In `log.js` `describe`, change `bust` to `` `${n(e.player)} busts on a duplicate ${label(e.card)}` `` and `flip7` to `` `${n(e.player)} flips seven! +15` ``; leave the rest.

- [ ] **Step 3: Verify landing, lobby, rules in Chrome at 360 px and 1100 px widths**

Use DevTools device toolbar at 360×780: the hero fan fits, the panel holds name + Quick play, no horizontal scroll on any view, controls sit above the safe area, six seats render in two columns with the sixth (you) in the rail. At 1100 px the table uses the grid: opponents across the top, draw zone centred, your rail across the bottom.

- [ ] **Step 4: Commit**

```bash
git add public/js/lobby.js public/js/log.js public/styles.css
git commit -m "Lobby open seats, log wording, responsive polish"
```

---

### Task 11: Verification pass, docs, IDEAS

**Files:**
- Modify: `README.md`, `AGENTS.md` (one line: the client presentation queue), `IDEAS.md`

- [ ] **Step 1: Full Chrome pass (spec §5)**

With the server on a free port, in a phone-width tab and a desktop-width tab: quick play through a bust, a Flip Three, a Second Chance save, a Freeze, a round summary, and game over. Reload mid-round: the table renders the snapshot with no replay and no `Catching up…` unless the window slid. Exercise the error path for a pending action: open the room in two tabs of the same profile (they share the seat token, and the second tab takes the seat over); press Hit in the first tab. Its socket closes with the takeover code, `onError` runs `table.clearPending()`, and the join card appears with no dead buttons behind it. Then in the live tab press Hit twice quickly: the second press is ignored locally and the buttons re-enable on the next state. Toggle reduced motion once. Record any defect, fix it in the module that owns it, add a `sequence`/`present` test if the defect was in planning or queue logic, and re-run `npm test`.

- [ ] **Step 2: Docs**

README: add under the running section: "Bots think for 1.8 to 2.6 s so reveals are readable (`BOT_DELAY_MIN_MS` / `BOT_DELAY_MAX_MS`)." AGENTS.md: add "- The browser client animates engine events from `game.history` via `public/js/sequence.js` (pure, tested) and `present.js`; `table.js` reconciles to the snapshot at each barrier. Keep `sequence.js`/`present.js` DOM-free."

IDEAS.md: add "- **Sound design** — deal/flip/bust cues with a mute toggle. *Why deferred:* visual pass first (2026-09-19)." and mark "Animate the card actually drawn", "Show the deciding round in the results view", and "Design pass on the results screen" as shipped by moving them under `## Shipped`.

- [ ] **Step 3: Commit**

```bash
git add README.md AGENTS.md
git commit -m "Document the presentation queue and bot delays"
```

(IDEAS.md is gitignored; edit it in the primary checkout `C:\dev\flip7` on `main`, not in the worktree.)

---

### Task 12: Codex subagent review

**Files:**
- Create: `docs/superpowers/reviews/2026-09-19-game-feel-codex-review.md`

- [ ] **Step 1: Run the review**

This task is run by the orchestrating session (which has the `codex:codex-rescue` agent type), not by an implementation subagent. Dispatch the `codex:codex-rescue` agent (read-only) against the worktree with: the spec path, the plan path, `git diff main...HEAD --stat`, and the instruction to review the finished branch for (a) spec conformance of `sequence.js`/`present.js`/`effects.js`/`table.js`, (b) correctness risks in the queue (barrier, cap, compression, reset), (c) visual/UX quality against spec §4 from the CSS and markup, (d) accessibility (live region, focus, aria labels), (e) test adequacy. It must end its report with a line `Verdict: PASS` or `Verdict: BLOCK` followed by findings ranked by severity.

- [ ] **Step 2: Record and act**

Save the report verbatim to `docs/superpowers/reviews/2026-09-19-game-feel-codex-review.md`. On BLOCK: fix every valid finding (with tests where the finding is in planner or queue logic), commit, and re-run the review, appending the new report under a `## Round N` heading. The jev-goal criterion `codex_review_pass` reads the file for `Verdict: PASS`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/reviews/2026-09-19-game-feel-codex-review.md
git commit -m "Record the Codex review of the game-feel branch"
```

---

## Self-review

- Spec coverage: §3.1 → Tasks 1, 2, 5; §3.2 → Task 3 (every event row has a case), Tasks 8–9 (every step kind has a handler or is a pure wait); §3.3 → Tasks 4–5 (compression, barrier, cap, reset), Task 7 (controls disabled before the barrier, focus at barrier); §3.4 → Task 7 (pending state, clears on newer turn, reconnect, error); §3.5 → Task 7 effects `render` + Task 9 `sheet`/`results`; §3.6 → Task 1; §4.1–4.3 → Task 6; §4.4 → Tasks 6, 7, 10; §5 → Tasks 2–5 tests, Task 11 Chrome pass, Task 12 Codex.
- Placeholders: the how-to-play markup is "copy verbatim from the current file", which is a concrete instruction, not a placeholder.
- Names: `history_start`, `gameId`, `summaryTimer`, `roundSummary` (Task 1) match their uses in Tasks 5 and 7; `createPresenter`/`enqueue`/`reset` match Task 7's app.js; step kinds in Task 3 match the handler keys in Tasks 8–9; `table` helper names in Task 7 match their calls in Tasks 8–9.
