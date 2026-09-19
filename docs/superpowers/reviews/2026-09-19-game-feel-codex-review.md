# Codex review — game-feel branch

Reviewer: Codex (codex:codex-rescue subagent), read-only. Spec: `docs/superpowers/specs/2026-09-19-flip7-game-feel-design.md`.

## Round 1 — head a7f7805 (base 60ee415)

# Implementation review

The focused test command passed all 45 tests. Static review found no Critical issues, but several Important spec gaps remain.

## Important

1. **The opening deal is animated while the table is still hidden and has no seat destinations.**
   `public/js/present.js:80-92` intentionally starts the lobby-to-game cursor at zero and calls only `preRender`; `public/js/effects.js:15` switches to the table only during the eventual barrier render. Moreover, `public/js/table.js:121-136` creates seats only for settled renders. Consequently, opening cards travel against hidden/stale DOM—often deck-to-deck—and the player sees the completed table snap in at the barrier. Returning to the lobby also leaves stale table/parked state because `public/js/effects.js:13` ignores lobby renders and `public/js/app.js:92` does not call `table.stop()`.
   **Fix:** on the first playing snapshot, show the table and reconcile an empty keyed seat/deck scaffold before queueing deal steps. Add an explicit effects reset that clears seats, parked cards, effects, pips, and transition state when entering the lobby or changing games.

2. **Summary and results transitions are rendered twice.**
   `public/js/effects.js:90-91` presents the sheet/results when their queue steps begin, but the barrier later invokes `effects.render`, which calls `renderSheet`/`renderResults` again at `public/js/effects.js:16-18`. `renderSheet` rebuilds every row and restarts its interval from the snapshot's original `remainingMs` (`public/js/table.js:187-200`), making the progress track jump backward and replaying row animations. Results similarly rebuild and replay the fan.
   **Fix:** track which terminal transition has already been presented and make barrier reconciliation preserve it, or make terminal rendering idempotent and calculate remaining progress from snapshot arrival time.

3. **The Second Chance save does not animate both discarded objects.**
   The binding storyboard requires the duplicate and shield to travel to discard. At `public/js/effects.js:49`, the shield is hidden immediately while only the flying duplicate moves; `public/js/effects.js:50` then updates the discard. The shield therefore flashes and vanishes instead of being visibly spent.
   **Fix:** create or move a shield token alongside the duplicate for the `to-discard` duration, removing both only when the step ends.

4. **Accessibility does not meet the single-live-region and focus requirements.**
   There are two polite live regions: the caption (`public/index.html:67`) and `#live` (`public/index.html:122`), with connection/turn announcements sent to the latter (`public/js/app.js:16,62,94`). This can produce competing announcements. Additionally, Hit focus is skipped whenever Stay retains focus (`public/js/table.js:159-163`), despite the requirement to focus Hit whenever a new hit/stay decision becomes enabled. Card labels themselves are present, and the target picker normally focuses its first option.
   **Fix:** make the caption the sole live region and route connection/turn announcements through it; remove the Stay-focus exception and use `lastTurnCued` alone to focus Hit once per new turn.

## Minor

5. **"Catching up…" never observes its specified 600 ms lifetime.**
   `public/js/present.js:85` sets the caption but never schedules its removal. It remains until an unrelated caption replaces it.
   **Fix:** expose a cancellable caption timeout through effects and clear this message after 600 ms or on the next caption.

6. **Queue cancellation and exception recovery have edge-case leaks.**
   `flush()` clears the active timer without resolving the promise (`public/js/present.js:32-35`), leaving one suspended pump per reset. Also, `fx.end(step)` and barrier rendering share one `try` block (`public/js/present.js:57-69`); an exception from `begin`/`end` on a barrier skips reconciliation permanently for that snapshot.
   **Fix:** resolve the active wait after incrementing the generation, and place barrier cleanup/rendering in a protected `finally` path independent of effect-hook failures.

7. **Several smaller visual details miss §4.**
   Parked cards have a dashed outline but no visible "pending" mark (`public/styles.css:138-139`). The countdown enters its scaling class only at two seconds and does not restart for each numeral (`public/js/table.js:118`, `public/styles.css:98`), rather than scaling 3, 2, and 1 individually. Target prompts also say "Give Freeze/Flip 3 to" (`public/js/table.js:168`).
   **Fix:** add the pending label, restart a numeral animation on each of the final three integer changes, and use action-specific target wording.

## Test adequacy

The sequence and fake-clock coverage is strong for cursoring, ordering, compression floors, caps, and sheet cuts. However, the fake effects in `tests/present.test.mjs:26-34` cannot detect hidden-view animation, missing keyed destinations, duplicate terminal renders, shield disappearance, focus, or live-region behavior. Add DOM-level tests for lobby-to-first-deal initialization, play-again reset, terminal-step idempotence, Second Chance disposal, and focus/live-region policy.

Verdict: BLOCK

## Round 2 — head a023389

The focused tests pass: 47/47.

1. **NOT ADDRESSED — opening scaffold/reset.** The first deal now gets visible seats via `present.js:86-90` and `effects.js:33`. However, lobby cleanup at `effects.js:35` only calls `hideSheet`, `stop`, and `clearPending`; `table.stop()` at `table.js:26` does not clear `#parked`, `#fxLayer`, or deck/discard transition styles. Because flushing can bypass an active effect's end handler (`present.js:34,60`), transient styles such as reshuffle cleanup at `effects.js:121-122` can survive into another game. Add a comprehensive transient-state reset and invoke it for lobby/new-game transitions.

2. **NOT ADDRESSED — duplicate terminal rendering.** Summary rendering is guarded at `effects.js:42`, and elapsed summary time is accounted for at `table.js:207-211`. Results still replay: `effects.js:37` first calls `showView("tableView")`, which necessarily hides `#resultsView`; therefore the `$("resultsView").hidden` guard at `effects.js:43` is always true and `renderResults` runs again after its step already ran at `effects.js:139`. Preserve whether results were already presented before switching views, or track the presented transition explicitly.

3. **ADDRESSED — Second Chance disposal.** `effects.js:81-92` clones the visible shield and animates it toward discard; `effects.js:94-98` hides the real shield and removes the clone only after the step ends.

4. **NOT ADDRESSED — live announcements/focus.** `index.html:67,122` now leaves only `#caption` live, and `table.js:166-168` removes the Stay-focus exception. But connection status is still written to non-live `#live` at `app.js:16,62`, rather than the caption. Moreover, the new scaffold calls settled `table.render` (`effects.js:33`), which focuses Hit and records `lastTurnCued` before playback (`table.js:166-168`); the immediate pre-render at `present.js:102` disables controls, and the eventual barrier cannot restore focus because that turn was already recorded.

5. **ADDRESSED — "Catching up…" lifetime.** `present.js:95` requests a 600 ms caption, while `effects.js:25-28` cancels prior timers and clears the message after that duration.

6. **ADDRESSED — cancellation/recovery.** `present.js:32-35` resolves the cancelled active wait, and barrier reconciliation is independently protected at `present.js:65-74`. The new regression test is at `tests/present.test.mjs:252-261`.

7. **ADDRESSED — visual details.** Parked cards gain a visible pending indicator at `styles.css:139-140`; countdown animation is restarted on integer changes through the final three seconds at `table.js:121-125` and `styles.css:98`; action-specific prompts are defined and used at `table.js:5,173-175`.

New Important issues introduced by the fix:

- **Opening scaffold consumes the decision focus cue prematurely.** Evidence: `effects.js:33`, `table.js:166-168`, and `present.js:102`. Fix by scaffolding with `game.decision = null` or adding a dedicated seat-only scaffold path; then pre-render the real decision disabled and let the barrier's settled render perform the sole focus cue. Add a DOM regression test.
- **Connection announcements were silenced instead of consolidated.** Evidence: `index.html:122` removes live semantics while `app.js:62` continues writing there. Fix by routing connection announcements through the sole caption live region without overwriting active game captions, or provide an equivalent single-region announcement policy.

Verdict: BLOCK

## Round 3 — head e8b7944

Focused tests pass: 48/48.

1. **ADDRESSED — results rendered twice.** `effects.render` captures `resultsShown` before changing views at `public/js/effects.js:28`, then switches to results and only calls `renderResults` when it was not already shown at `public/js/effects.js:30-36`. The initial results step remains at `public/js/effects.js:140`.

2. **ADDRESSED — scaffold consumed the focus cue.** `scaffoldState` explicitly sets `decision: null` and clears legal actions at `public/js/sequence.js:24-34`; `effects.scaffold` renders that state at `public/js/effects.js:18-21`. Consequently, the settled scaffold cannot enter the focus block at `public/js/table.js:175-185`. The regression test covers nulling without mutation at `tests/sequence.test.mjs:286-318`.

3. **NOT ADDRESSED — comprehensive transient reset.** The reset itself clears the identified transient DOM state at `public/js/table.js:31-42`, and it is invoked for scaffolding and lobby/no-game rendering at `public/js/effects.js:18-24`. However, the specification also requires reset on leaving a room and every new `gameId`. `leaveRoom` calls `table.stop()` but not `table.resetTransients()` at `public/js/app.js:34-38`. A mid-game `gameId` change from a non-lobby phase also skips `scaffold` at `public/js/present.js:86-95`, so deck/discard inline animation state can survive into the newly rendered game.

   **Concrete fix:** expose an effects reset or call `table.resetTransients()` from `leaveRoom`, and invoke the same reset unconditionally whenever `gameId` changes before choosing scaffold versus immediate reconciliation. Add a presenter/DOM regression covering a non-lobby `gameId` change during reshuffle.

4. **ADDRESSED — single live region and connection announcements.** `#caption` is the sole remaining polite live region at `public/index.html:67`; the former `#live` element is absent at `public/index.html:121-122`. Connection changes route through `live()` to `#caption` at `public/js/app.js:21-24,71`.

**New Critical/Important breakage introduced by this diff:** None found. The blocker is the incomplete reset path above, which remains from the round-2 finding.

Verdict: BLOCK

## Round 4 — head 8d4348a

**ADDRESSED** — the round-3 transient-reset item is resolved.

- Leaving a room invokes `table.resetTransients()` before presenter teardown: `public/js/app.js:34`.
- `effects.reset()` clears table transients plus the local `pips` and `flying` maps: `public/js/effects.js:18`.
- Every playing-state `gameId` change flushes old work, calls `fx.reset()`, then chooses scaffold versus reconciliation: `public/js/present.js:86`.
- The regression covers reset ordering for both lobby-to-game and mid-game changes: `tests/present.test.mjs:265`.

**New Critical/Important breakage:** None found.

Focused verification passed: 49/49 tests, 0 failures.

Verdict: PASS
