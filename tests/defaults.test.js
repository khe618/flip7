"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../lib/engine");
const { observeGame } = require("../lib/view");
const { makeRequest } = require("../lib/request");
const { defaultAction } = require("../lib/defaults");

const P3 = ["p1", "p2", "p3"].map((id) => ({ id, name: id }));

test("defaultAction is always legal and stays on hit_or_stay", () => {
  let r = engine.step(engine.createGame({ players: P3, seed: 9 }), { type: "start_round" });
  let targets = 0;
  for (let i = 0; i < 300 && r.state.phase !== "game_over"; i++) {
    if (r.state.phase === "round_over") { r = engine.step(r.state, { type: "start_round" }); continue; }
    const id = engine.pendingPlayer(r.state);
    const legal = engine.legalActions(r.state);
    const action = defaultAction(makeRequest(observeGame(r.state, id), { gameId: "g", timeoutMs: 1, requestId: "r" }));
    assert.ok(legal.includes(action));
    if (legal.includes("stay")) assert.equal(action, "stay"); else targets++;
    // alternate hits to reach action cards
    r = engine.step(r.state, { type: "act", player: id, action: legal.includes("hit") && i % 2 ? "hit" : action });
  }
});
