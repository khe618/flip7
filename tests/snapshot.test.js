"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildState } = require("../lib/snapshot");
const { createRoomGame } = require("../lib/room-game");
const { readConfig } = require("../lib/config");
const { createClock } = require("./helpers/clock");

function room() {
  const clock = createClock(0);
  const r = { code: "abcd", phase: "lobby", seats: new Map(), visitors: new Set(), game: null };
  r.seats.set("s1", { id: "s1", name: "Kay", isBot: false, isAgent: false, connected: true, resumeToken: "tok1" });
  r.seats.set("s2", { id: "s2", name: "Agent", isBot: false, isAgent: true, connected: true, resumeToken: "tok2" });
  return { r, clock };
}

test("visitor shape is tiny; seated shape carries the game view and timer", () => {
  const { r, clock } = room();
  assert.deepEqual(buildState(r, null), { type: "state", room: "abcd", phase: "lobby", you: null, playerCount: 2, maxPlayers: 6 });
  const lobby = buildState(r, "s1");
  assert.equal(lobby.game, null);
  assert.deepEqual(lobby.seats, [{ id: "s1", name: "Kay", isBot: false, isAgent: false, connected: true }, { id: "s2", name: "Agent", isBot: false, isAgent: true, connected: true }]);
  r.game = createRoomGame({ config: readConfig({}), now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, random: () => 0.5, seed: () => 1, onChange: () => {}, log: () => {} });
  r.game.start([...r.seats.values()]);
  r.phase = "playing";
  const s = buildState(r, "s1");
  assert.equal(s.game.you, "s1");
  assert.equal(s.timer.turnNumber, 1);
  assert.equal(JSON.stringify(s).includes("tok"), false, "no resume tokens");
  assert.ok(!("deck" in s.game) && !("rngState" in s.game) && !("seed" in s.game));
  assert.equal(s.roundSummary, null);
  assert.equal(s.results, null);
});
