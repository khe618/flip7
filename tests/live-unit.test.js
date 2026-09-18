"use strict";
// Unit-level coverage for bench/live.js's game lifecycle bookkeeping, with no real server: drives
// driveLiveSeat's state machine directly via its `_handleState` test hook (the exact same
// onState -> handle path a real ws "state" message takes) using synthetic messages and an
// in-process fixture agent that counts start()/end() calls. This is what caught the original bug
// where adapter.start() fired on every round-1 turn instead of once per game.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { driveLiveSeat } = require("../bench/live");

const FIXTURE_PATH = path.join(__dirname, "fixtures", "counting-agent.js");
const FIXTURE_SPEC = "file:" + FIXTURE_PATH;

function playingState(turnNumber, round = 1) {
  return {
    type: "state", room: "unit", phase: "playing", you: "p1",
    game: {
      round, turnNumber, decision: null, current_player: null,
      players: [{ id: "p1", name: "you", seat: 0, score: 0 }, { id: "p2", name: "bot", seat: 1, score: 0 }],
    },
    timer: null,
  };
}

function gameOverState() {
  return {
    type: "state", room: "unit", phase: "game_over", you: "p1", results: { winner: "p1" },
    game: {
      round: 3, turnNumber: 40, decision: null, current_player: null, winner: "p1",
      players: [{ id: "p1", name: "you", seat: 0, score: 210 }, { id: "p2", name: "bot", seat: 1, score: 120 }],
    },
    timer: null,
  };
}

test("adapter.start() fires exactly once per game across several round-1 playing states, and end() once on game_over", async () => {
  // A refused local port: driveLiveSeat always calls connect(), but nothing here exercises the
  // socket — the state machine is driven directly via _handleState.
  const driver = driveLiveSeat({ url: "ws://127.0.0.1:1", room: "unit", spec: FIXTURE_SPEC, name: "unit", log: () => {} });
  const { calls } = require(FIXTURE_PATH);
  const before = { start: calls.start, end: calls.end };

  await driver._handleState(playingState(1));
  await driver._handleState(playingState(2));
  await driver._handleState(playingState(3));
  assert.equal(calls.start - before.start, 1, "start() must fire once, not once per turn");
  assert.equal(calls.end - before.end, 0);

  await driver._handleState(gameOverState());
  assert.equal(calls.end - before.end, 1);

  await driver.close();
});
