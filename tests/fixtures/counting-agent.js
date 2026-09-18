"use strict";
// In-process fixture for tests/live-unit.test.js: counts start/end hook calls so a test can
// drive bench/live.js's state machine with synthetic `state` messages (no real server) and
// assert start() fires exactly once per game and end() exactly once on game_over.
const calls = { start: 0, end: 0 };
module.exports = {
  name: "counting-agent",
  version: "t",
  calls,
  act(request) { return request.game.legal_actions[0] || "stay"; },
  start() { calls.start += 1; },
  end() { calls.end += 1; },
};
