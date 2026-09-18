"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { renderRequest, hashText, PROMPT_VERSION } = require("../lib/render-text");

const request = {
  protocol: "flip7-agent/1", request_id: "abc123", game_id: "g1", timeout_ms: 30000, retry: null,
  game: {
    phase: "round", round: 3, turnNumber: 41, you: "p2", target_score: 200, dealer: "p1", current_player: "p2",
    decision: { type: "hit_or_stay" }, legal_actions: ["hit", "stay"],
    players: [
      { id: "p1", name: "threshold25", seat: 0, score: 87, status: "stayed", numbers: [3, 7, 12], modifiers: ["x2"], second_chance: false, round_score: 44, unique_count: 3 },
      { id: "p2", name: "you", seat: 1, score: 61, status: "active", numbers: [0, 5, 9, 11], modifiers: ["+4"], second_chance: true, round_score: 29, unique_count: 4 },
    ],
    deck_remaining: 41, discard: [7, "+2", "freeze", 7, 3], resolution: [],
    results: null, winner: null,
    history: [{ type: "hit", player: "p1", card: 12, turnNumber: 39 }],
  },
};

test("renderRequest is stable for a fixture and mentions the essentials", () => {
  const text = renderRequest(request);
  assert.equal(text, renderRequest(request));
  assert.ok(text.startsWith(`Flip 7 (${PROMPT_VERSION})`));
  for (const needle of ["Round 3", "target 200", "You are p2", "0, 5, 9, 11", "+4", "Second Chance", "41 cards", "Legal actions: hit, stay", "Reply with JSON"]) {
    assert.ok(text.includes(needle), `missing "${needle}"`);
  }
  assert.ok(!text.includes("abc123"), "request ids are not part of the prompt");
});

test("retry and target decisions render", () => {
  const retry = { ...request, retry: { attempt: 2, reason: 'illegal action "hitt"; legal: hit, stay', previous: "hitt" } };
  assert.ok(renderRequest(retry).includes("Your previous reply was invalid"));
  const target = { ...request, game: { ...request.game, decision: { type: "choose_target", card: "freeze", candidates: ["p1", "p2"] }, legal_actions: ["target:p1", "target:p2"] } };
  assert.ok(renderRequest(target).includes("Choose a target for freeze"));
});

test("hashText changes when the text changes", () => {
  assert.match(hashText("a"), /^[0-9a-f]{16}$/);
  assert.notEqual(hashText("a"), hashText("b"));
  assert.equal(hashText("a"), hashText("a"));
});
