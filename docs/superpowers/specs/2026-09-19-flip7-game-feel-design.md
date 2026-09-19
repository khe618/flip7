# Flip 7 game feel: presentation queue and visual redesign

Date: 2026-09-19. Status: Codex-reviewed draft for owner approval. Supersedes §3.2 "Table", "Round summary" and "Results" of the 2026-09-17 design spec for the browser client. The engine and the benchmark are untouched; the view and snapshot gain three additive fields (§3.6).

## 1. Problem

The browser client renders each state snapshot as a whole. The engine applies a hit and its consequence in one `step`, so a duplicate number clears the line before any snapshot shows it: players bust without seeing the card they flipped. Flip Three resolves all three draws in one step, so three cards appear at once. Beyond that defect, the table reads as a dashboard of slate panels, not a card game: no deck or discard objects, small cards, no motion except a 250 ms pop on the last tile.

## 2. Goals and non-goals

Goals:

1. Every consequential card is seen before its consequence: the busting duplicate, each Flip Three card, the Second Chance that saves you, the action card that targets you.
2. The table looks and moves like a card game on a phone (360 px portrait, 2 to 6 players) and on desktop.
3. The authoritative countdown is always visible; the client aims to trail the server by at most 2.5 s, and a decision is never enabled before its causal cards have been shown.
4. `prefers-reduced-motion` keeps every caption and intermediate card for the same reading time, without travel or shake.

Non-goals: sound, spectators, engine changes, changing the benchmark or the agent decision protocol, a build step or UI dependency. One Google Font import is allowed.

## 3. Architecture

Three client modules replace the render-everything `table.js`:

| Module | Responsibility | Tested by |
| --- | --- | --- |
| `public/js/sequence.js` | Pure, no DOM: `newEvents(cursor, game)` selects unseen events by absolute index; `planSteps(events, prevGame, nextGame, opts)` turns them into presentation steps; `compress(steps, budgetMs)` applies the catch-up rules. | `tests/sequence.test.mjs` |
| `public/js/present.js` | Runs steps against the DOM: transient reveal card that travels deck to seat, flips, holds; parked set-aside cards; the summary sheet and results transition. Owns the queue, the decision barrier, and the reduced-motion branch. Sole owner of table / summary / results view switching. | Chrome pass |
| `public/js/table.js` | Reconciler: renders the authoritative snapshot (seats keyed by player id, cards keyed by value and ordinal, deck, discard, captions, countdown, controls). Never destroys a seat node between renders. | Chrome pass |

`app.js` keeps routing, lobby, landing, join. Every snapshot with `state.game` goes to `present.enqueue(state)`; `present` renders lobby-to-table, table-to-summary, summary-to-results transitions itself after the terminal step of the queue, and calls `table.render(latest)` when the queue drains or immediately when nothing is queued. `public/js/package.json` declares `"type": "module"` so node can import the client modules in tests.

### 3.1 History cursor

`observeGame` adds `history_start`: the absolute index in the game's full history of `history[0]` (0 when the window is empty). Absolute index of `history[i]` is `history_start + i`; it is monotonic across the whole game, including round changes. The window stays 40 events and per-round.

The client keeps `cursor` = the absolute index of the next event it has not presented, per game (reset when `state.phase` leaves `playing`, on a new `gameId`, and when the presenter is created).

`newEvents(cursor, game)`:

- `cursor === null` (fresh presenter: first snapshot after load, resume, or reconnect): return `{ events: [], reset: true, cursor: history_start + history.length }`. The snapshot is rendered at once with no replay.
- `history_start > cursor` (the window slid past events never seen): return `reset: true` the same way. A visible caption `Catching up…` for 600 ms is the only acknowledgment.
- Otherwise events are `history.slice(cursor - history_start)`; the new cursor is `history_start + history.length`.

Equality of events is never compared, so repeated identical events, a full 40-event window, and a new round all diff correctly. The client detects a new game by `state.gameId` (added, §3.6) rather than by history shape.

### 3.2 Steps

A step is `{ kind, player, card?, ms, tier, caption? }`. `tier` is one of `consequential` (a card that must be seen: reveal, bust pair, Second Chance pair, target of an action), `structural` (travel, sort, sweep to discard, seat handoff), or `cosmetic` (score roll, stamps, rings, notch lighting, deal stagger). Compression works on tiers (§3.3).

Reveals come from three source events, each combined with the card's kind:

| Source × card | Steps |
| --- | --- |
| `dealt` / `hit` / `flip_three_card` × number | `press-deck` 70 → `travel` 240 → `flip` 190 → `rest` 220 → `sort` 160 |
| × modifier | same reveal, then `score-roll` 220 |
| × action | reveal at the hand, `hold` 450, `to-discard` 220, then the consequence below; while a Flip Three frame is open for this player, `set_aside` parks the card beside the discard instead (§3.4) |
| `dealt` | as above with the initial-deal stagger of 110 ms per player; a dealt action card follows the action path, including a target decision |

Consequences follow the reveal they belong to (the engine emits them in order after the source event):

| Event | Steps | Budget |
| --- | --- | --- |
| `bust` | `pair` 500: the duplicate lands beside its twin, both outlined `--danger`; `shake` 280; caption `BUST · duplicate 8`; `hold` 550; `sweep` 320 of the whole line to discard | ~2.1 s incl. the reveal |
| `second_chance_saved` | `pair` 350, `shield-flash` 300, `to-discard` 300 for duplicate and shield, caption `SECOND CHANCE` | 1.35 s |
| `second_chance_kept` | `token-land` 260 | |
| `second_chance_given` | `token-arc` 360 from giver to receiver | |
| `second_chance_discarded` | caption only | |
| `freeze` | `freeze-sweep` 320 over the target hand; hand desaturates to 65 %; snowflake status; the banked round score stays bright | 1.2 s |
| `flip_three_started` | target marked with three card-back pips | |
| `flip_three_card` | reveal as above with `hold` 300 and `beat` 140 between cards; one pip removed per card | 2.7 s for three |
| `flip_three_ended` | pips removed; parked set-aside cards then resolve in their event order, each with its own consequence steps; if the target busted, parked cards sweep to discard with the line | |
| `set_aside` | card parks beside the discard with a small "pending" mark | |
| `stay` | `banked-stamp` 260; if preceded by `deck_exhausted`, caption `No cards left · banked` | |
| `flip7` | seventh card snaps, notches light 350, gold ring + `FLIP 7 +15` 900 | 1.7 s |
| `round_started` | caption `Round N · <dealer> deals` | |
| `reshuffle` | discard pile slides into the deck 300 | |
| `deck_exhausted` | caption | |
| `round_ended` | after the playfield drains: summary sheet (§5) | 900 ms |
| `game_over` | after the summary sheet: winner seat expands into results, seven-card fan 700 | 1.5 s |

Second Chance inside a Flip Three chain uses the same consequence rows; nested Flip Three (a Flip Three drawn during a Flip Three) is just another `flip_three_started` after `flip_three_ended`, and present keeps one parked-card list per player across snapshots until the frame ends.

Target decisions (`choose_target` for Freeze, Flip Three, or a second Second Chance) are a barrier: the picker is shown only after the action card's reveal step has completed (§3.3).

Easing tokens: `--move: cubic-bezier(.22,.8,.24,1)` for travel, `--snap: cubic-bezier(.2,1.35,.35,1)` for landings.

### 3.3 Queue, catch-up, and the decision barrier

- Steps run in order. A new snapshot appends its steps; the reconcile target is always the latest snapshot.
- Each snapshot's steps end with a `barrier` step carrying that snapshot's `turnNumber`. When the barrier runs, `table.render(latest)` reconciles and, if the latest snapshot asks this player for a decision, the controls are enabled and focus moves to Hit or the first target button.
- **Controls before the barrier:** the countdown and the disabled controls (label `Finishing reveal…`) render from the latest snapshot as soon as it arrives. Input is enabled only at the barrier. Hard cap: a barrier that has not run 4 s after its snapshot arrived runs immediately, dropping the steps ahead of it. So the worst case is a 4 s wait out of the 30 s turn.
- **Catch-up mode:** when the queued playtime exceeds 2.5 s, `compress` runs on the unstarted steps: cosmetic steps are dropped; structural steps drop to 0 ms except `sweep` (120 ms); consequential steps go to their minimums: `flip` 120, `rest` 150, bust `pair`+`hold` 600 total, Second Chance `pair` 400, action `hold` 250. If the queue is still over 2.5 s, "every consequential card is shown at its minimum" wins over the ceiling, bounded by the 4 s barrier cap above. The ceiling is a target; the barrier cap is the invariant.
- **Reset:** a `reset` diff, a phase change to `lobby`, a new `gameId`, or leaving the room flushes the queue, clears parked cards, and renders the snapshot at once.
- Reduced motion: `travel`, `shake`, `sweep`, `score-roll`, `token-arc`, scaling and rings are skipped; cards appear in place with a 120 ms colour emphasis; every consequential `hold` keeps its full duration (catch-up minimums still apply).

### 3.4 Pending action state

After Hit or Stay, the pressed button reads `Flipping…` or `Staying…` with a small spinner, both buttons disable at their current widths, and further clicks are ignored. The pending state clears when a snapshot with a newer `turnNumber` arrives, when the socket reconnects (`onConnection(true)`), or when an `error` message arrives, so a lost action never leaves the buttons dead. The target picker uses the same pending treatment.

### 3.5 Transitions

`present` owns the table, summary sheet, and results views. `app.showView` no longer hides the summary sheet. Order on a round that ends the game: the engine emits `round_ended` then `game_over` in one step and the snapshot arrives with `phase: game_over`; present plays the playfield steps, the summary sheet for the final round, then the results transition. If the next round's snapshot arrives while the sheet is up (auto-advance after 8 s, or a player pressed Next round), the sheet's remaining hold is cut to 300 ms and the new round's deal follows.

### 3.6 Server-side additions (all additive)

| Field | Where | Purpose |
| --- | --- | --- |
| `history_start` | `observeGame` output | absolute index of `history[0]` (§3.1) |
| `gameId` | snapshot top level | new-game detection; already tracked by room-game |
| `summaryTimer: { remainingMs }` | snapshot, when the game phase is `round_over` | progress track on Next round |
| `roundSummary` | snapshot, also when the game phase is `game_over` | the deciding round's earned scores for the summary sheet and results |

`BOT_DELAY_MIN_MS` 700 → 1800 and `BOT_DELAY_MAX_MS` 1500 → 2600 in `lib/config.js`; `tests/config.test.js`, `README.md`, and the 2026-09-17 spec table updated. `docs/agent-protocol.md` gains one line for `history_start`. Tests: `view.test.js` asserts `history_start` counts correctly across rounds and at the 40 window; `snapshot.test.js` asserts the three snapshot fields.

## 4. Visual design

### 4.1 Tokens and type

```
--rail #111917   page background
--felt #071C1A   play area, with --felt-light #0D2A26 radial highlights
--surface #172421  seats, sheets
--paper #F4E6C5  number card face; --ink #171914 its numeral
--gold #F6B941   active seat, Hit, scores
--cyan #50C7D9   modifiers, Freeze
--coral #F06A62  action cards
--danger #FF4D55 bust
--success #55D68B banked / Stay
--text #F2EEE3  --muted #9AADA7  --edge #30443F
```

Barlow Condensed 600/700/800 (Google Fonts, `display=swap`) for the logo, numerals, scores, countdown, and card faces; the existing system sans stack for prose and controls. Tabular numerals everywhere.

Kept from the current CSS: semantic number/modifier/action distinction, focus ring, safe-area padding, 44 px minimum targets, sticky controls, the reduced-motion block. Removed: slate dashboard background, identical bordered player rows, text-only deck/discard counters, the table-style round overlay, the originless pop flip. Class names: playing cards are `.playing-card`; the round sheet is `.summary-sheet`; no element reuses `.card`.

### 4.2 Cards

5:7 ratio. Your hand 50×70, opponents 36×50 overlapped 10 px, reveal card in flight 58×82. At 360 px your cards may shrink to 42×59 and overlap 8 px, and the hand may wrap to three rows, so the worst case (six numbers, six modifiers, a shield, a transient seventh card) fits without horizontal scroll.

- Number: paper face, 34 px numeral centred, 12 px index bottom-right, seven notches along the bottom edge with one filled per unique number the owner holds.
- Modifier: cyan face, subtle geometric pattern, `×2` / `+6`.
- Action: coral face, white title, inline SVG glyph: snowflake (Freeze), three descending cards (Flip Three), shield (Second Chance).
- Held Second Chance: a small shield token beside the hand, not a card slot.
- Back: deep teal, double gold keyline, seven-sided burst with a `7`; recognisable at 36×50.
- Discard: the real top card rotated 4°, two offset dark cards beneath. Deck: a stack of backs with the remaining count.
- Every card has an accessible name (`aria-label="number 8"`, `"Freeze"`, `"plus 4"`).

### 4.3 Table layout

Phone (360 px portrait), top to bottom, in DOM order:

1. Top rail 44 px: brand, room code, connection pill.
2. Sticky turn strip 46 px: whose decision, the event caption (a polite `aria-live` region; captions are the announcements), circular countdown.
3. Opponent seats in a two-column grid, 76 to 92 px tall; with five opponents the last spans both columns. Each seat: name, banked total, status glyph, hand at opponent size, round score.
4. Draw zone: deck with count, discard.
5. Your rail: raised surface, full-size cards, round score and banked total large. "You" is conveyed by placement; no "(you)" suffix.
6. Fixed controls above the safe area: Hit 60 % gold, Stay 40 % outlined green. The target picker replaces this bar and takes focus when enabled.

Desktop (≥ 760 px): CSS Grid, max 1120 px, opponents across the top and sides, draw zone centred, your rail across the bottom. Same DOM; only placement changes. Flight endpoints come from `getBoundingClientRect()`.

Active seat: gold edge that moves to the next seat over 180 ms, plus the countdown ring. Your turn: one pulse on Hit and a gold sweep across your rail, never a looping glow. Countdown ring colour: neutral above 6 s, gold 6–4, coral 4–2, danger below 2; only the final three numerals scale.

### 4.4 Other screens

- Landing: seven-card fan hero with one face-down card; name + Quick play in one panel; friend room and code entry demoted below.
- Lobby: seats around a felt panel; empty seats read `Open seat`; bots get a small gear mark; room code large and tap-to-copy.
- Summary sheet: bottom sheet raised in 260 ms, rows revealed at 70 ms intervals, columns `This round` and `Total`, busted players show an em dash, the auto-advance shown as a thin progress track on Next round driven by `summaryTimer`.
- Results: winner first with a seven-card fan and large score, other standings as compact rows, the deciding round's earned scores beside each, Play again prominent, quiet Copy room link.
- How to play: restyled to the tokens, content unchanged.

## 5. Testing

`tests/sequence.test.mjs` (node --test, ESM):

- `newEvents`: null cursor resets; cursor inside the window returns the tail; cursor equal to the end returns nothing; `history_start` past the cursor resets; a full 40-event window that slid by one returns exactly one event; a new round continues from the cursor without reset; a repeated identical snapshot returns nothing.
- `planSteps`: hit-number, hit-modifier, hit-action-with-target-barrier, dealt action, bust yields pair before sweep, Second Chance save, Second Chance chain inside Flip Three, Flip Three with a set-aside resolved after `flip_three_ended`, nested Flip Three, `deck_exhausted` + forced stay caption, `round_ended` + `game_over` in one snapshot ordering sheet before results, every snapshot ends with a barrier carrying its `turnNumber`.
- `compress`: drops cosmetic, floors consequential at the minimums, respects the bust 600 ms floor, and reports the remaining queue time.

Server tests: `view.test.js` for `history_start`, `snapshot.test.js` for `gameId`, `summaryTimer`, `roundSummary` on `game_over`, `config.test.js` for the new bot delays. Existing `npm test` stays green.

Chrome pass on the local server at phone and desktop widths: quick play through a bust, a Flip Three, a Second Chance save, a Freeze, a round summary, and game over; reduced-motion emulation once; reconnect mid-round renders the snapshot without replay; a pending Hit that is answered by an error re-enables the buttons.

Codex subagent review of the finished branch: verdict recorded in `docs/superpowers/reviews/2026-09-19-game-feel-codex-review.md`; the goal passes only on a PASS verdict.

## 6. Implementation order

1. Server additive fields and bot delays with tests.
2. `sequence.js` with tests; `present.js` queue, reveal card, barrier, catch-up; `table.js` keyed reconciler; pending-button state.
3. Deck and discard objects; hit, bust, Second Chance storyboards.
4. Table reshaped into seats / draw zone / your rail with the new tokens, fonts, and card faces.
5. Flip Three (with parked cards), Freeze, Stay, Flip 7.
6. Turn ring, countdown colours, reduced motion, live-region captions, focus policy.
7. Landing, lobby, summary sheet, results.
8. Responsive, keyboard, reconnect verification; docs; Codex review.

## 7. Amendments (from the Codex plan review, 2026-09-19)

- The Second Chance `pair` step is 400 ms with a 400 ms floor (was 350 with a 400 total floor, which was contradictory); `shield-flash` 300 ms, floor 150.
- A kept Second Chance never goes to the discard: the reveal ends with a `to-token` step into the shield, and a given one arcs from the discard (it is the giver's second card).
- `timer` and `summaryTimer` carry `totalMs` so the countdown ring and the Next round track use the configured `TURN_MS` / `ROUND_SUMMARY_MS`.
- `roundSummary.rows[i].status` carries the line status so the sheet shows an em dash only for busted players.
- Only the newest barrier enables input: an older barrier's render is followed by a pre-render of the latest snapshot.
- The 4 s cap is enforced by a per-barrier deadline that cuts the active step; a new round arriving during the sheet's reveal cuts it to 300 ms.
- Catch-up compression never shortens the `sheet`/`results` steps and they are excluded from the 2.5 s budget sum; the 300 ms sheet cut applies only when the next round arrives.

## 8. Do not

Render the snapshot first and animate ghosts over it. Use modals for routine card events. Add looping glows, particles, or confetti. Shrink six full rows until cards are unreadable. Let presentation delay input silently or past the 4 s cap.
