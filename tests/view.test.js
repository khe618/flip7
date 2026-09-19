"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../lib/engine");
const cards = require("../lib/cards");
const { observeGame, unseenCounts } = require("../lib/view");
const { makeRequest, PROTOCOL, newRequestId } = require("../lib/request");
const { deckFrom } = require("./helpers/deck");

const P3 = [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }, { id: "p3", name: "Three" }];
const FORBIDDEN = ["deck", "rngState", "seed", "lines", "dealCursor"];

function hasKeyDeep(obj, key) {
  if (obj === null || typeof obj !== "object") return false;
  if (Array.isArray(obj)) return obj.some((v) => hasKeyDeep(v, key));
  return Object.keys(obj).some((k) => k === key || hasKeyDeep(obj[k], key));
}

function playSeeded(seed, steps, visit) {
  let r = engine.step(engine.createGame({ players: P3, seed }), { type: "start_round" });
  for (let i = 0; i < steps && r.state.phase !== "game_over"; i++) {
    visit(r.state);
    if (r.state.phase === "round_over") { r = engine.step(r.state, { type: "start_round" }); continue; }
    const legal = engine.legalActions(r.state);
    r = engine.step(r.state, { type: "act", player: engine.pendingPlayer(r.state), action: legal[i % legal.length] });
  }
  visit(r.state);
}

test("the view never contains hidden keys in any phase", () => {
  const lobby = engine.createGame({ players: P3, seed: 5 });
  for (const s of [lobby]) for (const k of FORBIDDEN) assert.ok(!hasKeyDeep(observeGame(s, "p1"), k), k);
  playSeeded(5, 300, (s) => {
    const v = observeGame(s, "p2");
    for (const k of FORBIDDEN) assert.ok(!hasKeyDeep(v, k), `${k} leaked in phase ${s.phase}`);
  });
});

test("required keys are present and legal_actions is per recipient", () => {
  const r = engine.step(engine.createGame({ players: P3, seed: 1, deck: deckFrom([4, 6, 8, "freeze"]) }), { type: "start_round" });
  const r2 = engine.step(r.state, { type: "act", player: "p2", action: "hit" });
  const mine = observeGame(r2.state, "p2");
  const theirs = observeGame(r2.state, "p1");
  for (const k of ["phase", "round", "turnNumber", "you", "target_score", "dealer", "current_player", "decision", "legal_actions", "players", "deck_remaining", "discard", "resolution", "results", "winner", "history"]) {
    assert.ok(k in mine, k);
  }
  assert.deepEqual(mine.decision, { type: "choose_target", card: "freeze", candidates: ["p1", "p2", "p3"] });
  assert.deepEqual(mine.legal_actions, engine.legalActions(r2.state));
  assert.equal(theirs.decision, null);
  assert.deepEqual(theirs.legal_actions, []);
  assert.equal(theirs.current_player, "p2");
  assert.equal(mine.you, "p2");
  assert.deepEqual(mine.discard, ["freeze"]);
  assert.deepEqual(mine.resolution, [{ card: "freeze", drawer: "p2", target: null, remaining: 0, setAside: [], ended: false }]);
  assert.equal(mine.deck_remaining, 90);
});

test("player rows carry round_score, unique_count, second_chance and status", () => {
  const r = engine.step(engine.createGame({ players: P3, seed: 1, deck: deckFrom(["x2", 6, 8, 10, "+4"]) }), { type: "start_round" });
  let s = engine.step(r.state, { type: "act", player: "p2", action: "hit" }).state; // 10
  s = engine.step(s, { type: "act", player: "p3", action: "stay" }).state;
  s = engine.step(s, { type: "act", player: "p1", action: "hit" }).state; // +4
  const v = observeGame(s, "p1");
  const p2 = v.players.find((p) => p.id === "p2");
  assert.deepEqual(p2, { id: "p2", name: "Two", seat: 1, score: 0, status: "active", numbers: [10], modifiers: ["x2"], second_chance: false, round_score: 20, unique_count: 1 });
  assert.equal(v.players.find((p) => p.id === "p3").status, "stayed");
  assert.equal(v.players.find((p) => p.id === "p1").round_score, 12);
});

test("unseen cards are exactly the deck at every step", () => {
  playSeeded(11, 400, (s) => {
    const v = observeGame(s, "p1");
    const unseen = unseenCounts(v);
    const deckCounts = {};
    for (const c of s.deck) deckCounts[cards.cardKey(c)] = (deckCounts[cards.cardKey(c)] || 0) + 1;
    for (const k of Object.keys(cards.cardCounts())) assert.equal(unseen[k] || 0, deckCounts[k] || 0, `card ${k} in phase ${s.phase} turn ${s.turnNumber}`);
    assert.equal(Object.values(unseen).reduce((a, b) => a + b, 0), v.deck_remaining);
  });
});

test("history is this round's last 40 events and results appear when the round is over", () => {
  let r = engine.step(engine.createGame({ players: P3, seed: 2 }), { type: "start_round" });
  for (let i = 0; i < 400 && r.state.phase === "round"; i++) {
    r = engine.step(r.state, { type: "act", player: engine.pendingPlayer(r.state), action: engine.legalActions(r.state)[0] });
  }
  const v = observeGame(r.state, "p1");
  assert.ok(v.history.length <= 40);
  assert.ok(v.history.every((e) => typeof e.turnNumber === "number"));
  assert.equal(r.state.phase, "round_over", "always hitting ends the round (bust or Flip 7)");
  assert.deepEqual(v.results, r.state.round.results);
  const r2 = engine.step(r.state, { type: "start_round" });
  const v2 = observeGame(r2.state, "p1");
  assert.equal(v2.history[0].type, "round_started", "history restarts with the new round");
  assert.equal(v2.history[0].roundNumber, 2);
  assert.equal(v2.results, null);
});

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

test("makeRequest wraps the view without touching it", () => {
  const s = engine.step(engine.createGame({ players: P3, seed: 1 }), { type: "start_round" }).state;
  const view = observeGame(s, "p2");
  const req = makeRequest(view, { gameId: "abc", timeoutMs: 1234, requestId: "r1" });
  assert.deepEqual(Object.keys(req), ["protocol", "request_id", "game_id", "timeout_ms", "retry", "game"]);
  assert.equal(req.protocol, PROTOCOL);
  assert.equal(PROTOCOL, "flip7-agent/1");
  assert.equal(req.retry, null);
  assert.deepEqual(req.game, view);
  assert.match(newRequestId(), /^[0-9a-f]{6}$/);
  assert.notEqual(newRequestId(), newRequestId());
});
