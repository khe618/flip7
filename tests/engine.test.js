"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../lib/engine");
const { deckFrom } = require("./helpers/deck");

const P2 = [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }];
const P3 = [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }, { id: "p3", name: "Three" }];

function game(players, top, opts = {}) {
  const s = engine.createGame({ players, seed: 1, deck: Array.isArray(top) ? deckFrom(top) : undefined, ...opts });
  return engine.step(s, { type: "start_round" });
}
function act(r, player, action) { return engine.step(r.state, { type: "act", player, action }); }
function types(r) { return r.events.map((e) => e.type); }
function line(r, id) { return r.state.round.lines[id]; }

test("deals one card to each seat starting after the dealer, then asks the seat after the dealer", () => {
  const r = game(P2, [5, 8]);
  assert.equal(r.state.phase, "round");
  assert.equal(r.state.dealerSeat, 0);
  assert.deepEqual(line(r, "p2").numbers, [5]);
  assert.deepEqual(line(r, "p1").numbers, [8]);
  assert.deepEqual(r.state.round.pending, { type: "hit_or_stay", player: "p2" });
  assert.deepEqual(engine.legalActions(r.state), ["hit", "stay"]);
  assert.equal(engine.pendingPlayer(r.state), "p2");
  assert.equal(r.state.turnNumber, 1);
  assert.deepEqual(types(r), ["round_started", "dealt", "dealt"]);
  assert.equal(r.state.deck.length, 92);
});

test("hit adds a number, stay locks, settlement banks scores, dealer advances", () => {
  let r = game(P2, [5, 8, 3]);
  r = act(r, "p2", "hit");
  assert.deepEqual(line(r, "p2").numbers, [3, 5]);
  assert.equal(engine.pendingPlayer(r.state), "p1");
  r = act(r, "p1", "stay");
  assert.equal(line(r, "p1").status, "stayed");
  assert.equal(engine.pendingPlayer(r.state), "p2");
  r = act(r, "p2", "stay");
  assert.equal(r.state.phase, "round_over");
  assert.deepEqual(r.state.round.results, { p1: { roundScore: 8, flip7: false }, p2: { roundScore: 8, flip7: false } });
  assert.equal(r.state.players[0].score, 8);
  assert.equal(r.state.players[1].score, 8);
  assert.equal(r.state.dealerSeat, 1);
  assert.equal(r.state.round.pending, null);
  assert.equal(engine.legalActions(r.state).length, 0);
  // lines go to the discard in seat order, numbers ascending
  assert.deepEqual(r.state.discard, [8, 3, 5]);
  assert.equal(r.state.deck.length, 91);
});

test("bust discards the line and scores zero", () => {
  let r = game(P2, [5, 8, 5]);
  r = act(r, "p2", "hit");
  assert.equal(line(r, "p2").status, "busted");
  assert.deepEqual(line(r, "p2").numbers, []);
  assert.deepEqual(r.state.discard, [5, 5]);
  assert.ok(types(r).includes("bust"));
  assert.equal(engine.pendingPlayer(r.state), "p1");
  r = act(r, "p1", "stay");
  assert.equal(r.state.phase, "round_over");
  assert.equal(r.state.round.results.p2.roundScore, 0);
  assert.equal(r.state.round.results.p1.roundScore, 8);
});

test("flip 7 ends the round immediately with the bonus", () => {
  let r = game(P2, [1, 8, 2, 3, 4, 5, 6, 7, 9]);
  r = act(r, "p2", "hit"); // 2
  r = act(r, "p1", "stay");
  for (const _ of [3, 4, 5, 6]) r = act(r, "p2", "hit");
  assert.equal(r.state.phase, "round");
  r = act(r, "p2", "hit"); // 7 -> flip 7
  assert.equal(r.state.phase, "round_over");
  assert.ok(types(r).includes("flip7"));
  assert.deepEqual(r.state.round.results.p2, { roundScore: 43, flip7: true });
  assert.equal(r.state.players[1].score, 43);
  assert.equal(r.state.deck.length, 94 - 8, "the 9 was never flipped");
});

test("x2 doubles numbers before + modifiers are added", () => {
  let r = game(P2, ["x2", 8, 10, "+4"]);
  r = act(r, "p2", "hit"); // 10
  r = act(r, "p1", "stay");
  r = act(r, "p2", "hit"); // +4
  r = act(r, "p2", "stay");
  assert.equal(r.state.round.results.p2.roundScore, 24);
});

test("game ends when a single leader reaches the target", () => {
  let r = game(P2, [12, 8, 9], { targetScore: 20 });
  r = act(r, "p2", "hit"); // 21
  r = act(r, "p1", "stay");
  r = act(r, "p2", "stay");
  assert.equal(r.state.phase, "game_over");
  assert.equal(r.state.winner, "p2");
  assert.equal(r.state.dealerSeat, 0, "dealer does not advance after the final round");
  const last = r.events[r.events.length - 1];
  assert.equal(last.type, "game_over");
  assert.deepEqual(last.scores, { p1: 8, p2: 21 });
  assert.throws(() => engine.step(r.state, { type: "start_round" }), engine.IllegalAction);
});

test("a tie at the target plays another round and the dealer still advances", () => {
  let r = game(P2, [12, 12, 8, 8], { targetScore: 20 });
  r = act(r, "p2", "hit"); // 20
  r = act(r, "p1", "hit"); // 20
  r = act(r, "p2", "stay");
  r = act(r, "p1", "stay");
  assert.equal(r.state.phase, "round_over");
  assert.equal(r.state.winner, null);
  assert.equal(r.state.dealerSeat, 1);
  const r2 = engine.step(r.state, { type: "start_round" });
  assert.equal(r2.state.roundNumber, 2);
  assert.equal(engine.pendingPlayer(r2.state), "p1", "seat after the new dealer");
});

test("the deck persists across rounds", () => {
  let r = game(P2, [5, 8, 3]);
  r = act(r, "p2", "hit");
  r = act(r, "p1", "stay");
  r = act(r, "p2", "stay");
  const deckBefore = r.state.deck.slice();
  const r2 = engine.step(r.state, { type: "start_round" });
  assert.deepEqual(r2.state.deck, deckBefore.slice(2));
  assert.deepEqual(r2.state.discard, [8, 3, 5]);
});

test("deck exhausted with an empty discard turns a hit into a stay", () => {
  let r = engine.step(engine.createGame({ players: P2, seed: 1, deck: [5, 8] }), { type: "start_round" });
  r = act(r, "p2", "hit");
  assert.deepEqual(types(r), ["deck_exhausted", "stay"]);
  assert.equal(line(r, "p2").status, "stayed");
});

test("an empty deck reshuffles the discard pile", () => {
  let r = engine.step(engine.createGame({ players: P2, seed: 1, deck: [5, 8, 5, 9] }), { type: "start_round" });
  r = act(r, "p2", "hit"); // bust: discard [5,5]
  r = act(r, "p1", "hit"); // 9
  assert.equal(r.state.deck.length, 0);
  r = act(r, "p1", "hit"); // reshuffle [5,5] -> draws a 5
  assert.ok(types(r).includes("reshuffle"));
  assert.equal(r.events.find((e) => e.type === "reshuffle").count, 2);
  assert.deepEqual(line(r, "p1").numbers, [5, 8, 9]);
  assert.equal(r.state.deck.length, 1);
  assert.deepEqual(r.state.discard, []);
});

test("same seed and actions replay identically; different seeds deal differently", () => {
  function play(seed) {
    let r = engine.step(engine.createGame({ players: P3, seed }), { type: "start_round" });
    for (let i = 0; i < 40 && r.state.phase !== "game_over"; i++) {
      if (r.state.phase === "round_over") { r = engine.step(r.state, { type: "start_round" }); continue; }
      const legal = engine.legalActions(r.state);
      r = act(r, engine.pendingPlayer(r.state), legal.includes("stay") ? (i % 3 === 0 ? "stay" : "hit") : legal[0]);
    }
    return r.state;
  }
  assert.deepEqual(play(7), play(7));
  assert.notDeepEqual(play(7).history, play(8).history);
});

test("step never mutates its input and rejects illegal inputs", () => {
  const r = game(P2, [5, 8]);
  const frozen = JSON.stringify(r.state);
  assert.throws(() => act(r, "p1", "hit"), /belongs to p2/);
  assert.throws(() => act(r, "p2", "target:p1"), /illegal action/);
  assert.throws(() => engine.step(r.state, { type: "start_round" }), /cannot start/);
  assert.throws(() => engine.step(r.state, { type: "nope" }), engine.IllegalAction);
  act(r, "p2", "hit");
  assert.equal(JSON.stringify(r.state), frozen);
});

test("createGame validates players", () => {
  assert.throws(() => engine.createGame({ players: [{ id: "a", name: "a" }], seed: 1 }));
  assert.throws(() => engine.createGame({ players: P2.concat(P2), seed: 1 }));
});
