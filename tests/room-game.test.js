"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRoomGame } = require("../lib/room-game");
const { readConfig } = require("../lib/config");
const { createClock } = require("./helpers/clock");
const { deckFrom } = require("./helpers/deck");

function setup(over = {}) {
  const clock = createClock(0);
  const changes = [];
  const config = { ...readConfig({}), TURN_MS: 1000, ROUND_SUMMARY_MS: 500, BOT_DELAY_MIN_MS: 100, BOT_DELAY_MAX_MS: 200, ...over };
  // deck is a test-only option: seat 1 is dealt 5, seat 0 is dealt 8, the first hit flips 3
  const g = createRoomGame({ config, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, random: () => 0.5, seed: () => 11, deck: deckFrom([5, 8, 3, 9, 7, 2, 4, 6, 10, 11]), onChange: () => changes.push(1), log: () => {} });
  return { clock, g, changes, config };
}

const HUMANS = [{ id: "s1", name: "Kay", isBot: false }, { id: "s2", name: "Lee", isBot: false }];

test("start deals, arms the turn timer, and the timer applies the default action", () => {
  const { g, clock, changes } = setup();
  g.start(HUMANS);
  assert.equal(g.phase, "round");
  const pending = g.state.round.pending;
  assert.equal(pending.type, "hit_or_stay");
  assert.deepEqual(g.timerInfo(), { turnNumber: 1, remainingMs: 1000 });
  clock.advance(400);
  assert.equal(g.timerInfo().remainingMs, 600);
  const before = changes.length;
  clock.advance(600);
  assert.ok(changes.length > before);
  assert.equal(g.state.round.lines[pending.player].status, "stayed", "timeout defaults to stay");
  assert.equal(g.state.round.pending.player, pending.player === "s1" ? "s2" : "s1");
});

test("act validates turn number and legality", () => {
  const { g } = setup();
  g.start(HUMANS);
  const p = g.state.round.pending.player;
  assert.throws(() => g.act(p, 99, "hit"), (e) => e.code === "stale_turn");
  assert.throws(() => g.act(p === "s1" ? "s2" : "s1", 1, "hit"), (e) => e.code === "not_your_turn");
  assert.throws(() => g.act(p, 1, "target:s1"), (e) => e.code === "illegal_action");
  g.act(p, 1, "hit");
  assert.equal(g.state.turnNumber, 2);
});

test("a stale turn timer is a no-op after the player acts", () => {
  const { g, clock } = setup();
  g.start(HUMANS);
  const p = g.state.round.pending.player;
  clock.advance(900);
  g.act(p, 1, "hit");
  const t2 = g.state.turnNumber;
  clock.advance(200); // the old timer's due time passes; it must not fire a default for turn 1
  assert.equal(g.state.turnNumber, t2);
  assert.equal(g.timerInfo().turnNumber, t2);
  assert.equal(g.timerInfo().remainingMs, 800);
});

test("bots act after a jittered delay through the same act path", () => {
  const { g, clock } = setup();
  g.start([{ id: "s1", name: "Kay", isBot: false }, { id: "b1", name: "Bot", isBot: true, botPolicy: "threshold25" }]);
  // seat order: s1 dealer, b1 acts first
  assert.equal(g.state.round.pending.player, "b1");
  clock.advance(149);
  assert.equal(g.state.round.pending.player, "b1");
  clock.advance(1); // random 0.5 -> 150 ms
  assert.equal(g.state.round.pending.player, "s1");
});

test("round summary auto-advances and next-round with a stale number is ignored", () => {
  const { g, clock } = setup();
  g.start(HUMANS);
  for (let i = 0; i < 50 && g.phase === "round"; i++) g.act(g.state.round.pending.player, g.state.turnNumber, "stay");
  assert.equal(g.phase, "round_over");
  g.nextRound(99);
  assert.equal(g.phase, "round_over");
  clock.advance(500);
  assert.equal(g.phase, "round");
  assert.equal(g.state.roundNumber, 2);
});

test("dispose clears timers", () => {
  const { g, clock } = setup();
  g.start(HUMANS);
  g.dispose();
  assert.equal(clock.pending(), 0);
});
