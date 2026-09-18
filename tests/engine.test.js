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

test("Freeze on a hit asks the drawer for a target; the frozen player still settles", () => {
  let r = game(P3, [4, 6, 8, "freeze"]);
  // deal: p2:4 p3:6 p1:8 ; p2 hits freeze
  r = act(r, "p2", "hit");
  assert.deepEqual(r.state.round.pending, { type: "choose_target", player: "p2", card: "freeze", candidates: ["p1", "p2", "p3"] });
  assert.deepEqual(engine.legalActions(r.state), ["target:p1", "target:p2", "target:p3"]);
  assert.deepEqual(r.state.discard, ["freeze"]);
  r = act(r, "p2", "target:p3");
  assert.equal(line(r, "p3").status, "frozen");
  assert.ok(r.events.some((e) => e.type === "freeze" && e.from === "p2" && e.to === "p3"));
  assert.equal(engine.pendingPlayer(r.state), "p1", "p3 is skipped");
  r = act(r, "p1", "stay");
  r = act(r, "p2", "stay");
  assert.equal(r.state.round.results.p3.roundScore, 6);
});

test("a deal-time Freeze may target an undealt player, who is then skipped by the deal", () => {
  let r = game(P3, ["freeze", 6, 8]);
  assert.deepEqual(r.state.round.pending, { type: "choose_target", player: "p2", card: "freeze", candidates: ["p1", "p2", "p3"] });
  r = act(r, "p2", "target:p3");
  assert.equal(line(r, "p3").status, "frozen");
  assert.deepEqual(line(r, "p3").numbers, []);
  assert.deepEqual(line(r, "p1").numbers, [6]);
  assert.equal(r.state.deck[0], 8, "p3 received no card");
  assert.equal(engine.pendingPlayer(r.state), "p2");
  r = act(r, "p2", "stay");
  r = act(r, "p1", "stay");
  assert.equal(r.state.round.results.p3.roundScore, 0);
});

test("the only active player must target themselves (no decision asked)", () => {
  let r = game(P2, [4, 8, "freeze"]);
  r = act(r, "p2", "stay");
  r = act(r, "p1", "hit"); // freeze, p1 is the only active player
  assert.equal(r.state.round.pending, null);
  assert.equal(line(r, "p1").status, "frozen");
  assert.equal(r.state.phase, "round_over");
  assert.equal(r.state.round.results.p1.roundScore, 8);
});

test("Second Chance is kept, saves once, and the turn ends", () => {
  let r = game(P2, [4, 8, "second_chance", 4, 9]);
  r = act(r, "p2", "hit"); // keeps SC
  assert.equal(line(r, "p2").secondChance, true);
  assert.ok(types(r).includes("second_chance_kept"));
  assert.equal(engine.pendingPlayer(r.state), "p1", "turn ended");
  r = act(r, "p1", "stay");
  r = act(r, "p2", "hit"); // duplicate 4 -> saved
  assert.ok(types(r).includes("second_chance_saved"));
  assert.equal(line(r, "p2").secondChance, false);
  assert.equal(line(r, "p2").status, "active");
  assert.deepEqual(line(r, "p2").numbers, [4]);
  assert.deepEqual(r.state.discard, ["second_chance", 4]);
  assert.equal(engine.pendingPlayer(r.state), "p2", "still active, next turn is theirs");
});

test("a second Second Chance goes to the single eligible player automatically", () => {
  let r = game(P2, [4, 8, "second_chance", 9, "second_chance"]);
  r = act(r, "p2", "hit"); // keep
  r = act(r, "p1", "hit"); // 9
  r = act(r, "p2", "hit"); // must give; only p1 is eligible
  assert.equal(r.state.round.pending && r.state.round.pending.type, "hit_or_stay");
  assert.equal(line(r, "p1").secondChance, true);
  assert.equal(line(r, "p2").secondChance, true);
  assert.deepEqual(r.state.discard, [], "the given card left the discard");
  assert.ok(r.events.some((e) => e.type === "second_chance_given" && e.from === "p2" && e.to === "p1"));
});

test("a second Second Chance with several eligible players is a decision", () => {
  let r = game(P3, [4, 6, 8, "second_chance", 9, 10, "second_chance"]);
  r = act(r, "p2", "hit"); // keep
  r = act(r, "p3", "hit"); // 9
  r = act(r, "p1", "hit"); // 10
  r = act(r, "p2", "hit"); // second SC
  assert.deepEqual(r.state.round.pending, { type: "choose_target", player: "p2", card: "second_chance", candidates: ["p1", "p3"] });
  assert.deepEqual(r.state.discard, ["second_chance"]);
  r = act(r, "p2", "target:p3");
  assert.equal(line(r, "p3").secondChance, true);
  assert.deepEqual(r.state.discard, []);
});

test("a Second Chance nobody can take is discarded", () => {
  let r = game(P2, ["second_chance", "second_chance", "second_chance"]);
  assert.equal(line(r, "p2").secondChance, true);
  assert.equal(line(r, "p1").secondChance, true);
  r = act(r, "p2", "hit");
  assert.ok(types(r).includes("second_chance_discarded"));
  assert.deepEqual(r.state.discard, ["second_chance"]);
  assert.equal(r.state.round.resolution.length, 0);
});

test("Flip Three flips three cards into the target's line; play resumes after the drawer", () => {
  let r = game(P3, [1, 2, 3, "flip_three", 4, 5, "+2", 6]);
  r = act(r, "p2", "hit"); // flip_three
  assert.equal(r.state.round.pending.type, "choose_target");
  r = act(r, "p2", "target:p3");
  assert.deepEqual(line(r, "p3").numbers, [2, 4, 5]);
  assert.deepEqual(line(r, "p3").modifiers, ["+2"]);
  assert.deepEqual(types(r).filter((t) => t.startsWith("flip_three")), ["flip_three_started", "flip_three_card", "flip_three_card", "flip_three_card", "flip_three_ended"]);
  assert.equal(engine.pendingPlayer(r.state), "p3", "seat after the drawer p2");
  assert.equal(r.state.deck[0], 6);
  assert.equal(r.state.round.resolution.length, 0);
});

test("Flip Three stops on a bust", () => {
  let r = game(P3, [1, 2, 3, "flip_three", 2, 5, 6]);
  r = act(r, "p2", "hit");
  r = act(r, "p2", "target:p3"); // flips 2 -> bust
  assert.equal(line(r, "p3").status, "busted");
  assert.equal(r.state.deck[0], 5, "remaining flips untouched");
  assert.equal(engine.pendingPlayer(r.state), "p1");
});

test("Flip 7 during a Flip Three ends the round and drops set-asides", () => {
  let r = game(P2, [1, 8, 2, 3, 4, 5, "flip_three", "freeze", 6, 7, 9]);
  r = act(r, "p2", "hit"); // 2
  r = act(r, "p1", "stay");
  r = act(r, "p2", "hit"); r = act(r, "p2", "hit"); r = act(r, "p2", "hit"); // 3 4 5
  r = act(r, "p2", "hit"); // flip_three, only active -> self
  assert.equal(r.state.phase, "round_over");
  assert.ok(types(r).includes("set_aside"));
  assert.ok(types(r).includes("flip7"));
  assert.ok(!types(r).includes("freeze"));
  assert.deepEqual(r.state.round.results.p2, { roundScore: 43, flip7: true });
  assert.equal(r.state.deck[0], 9);
  assert.equal(r.state.round.resolution.length, 0);
});

test("a Second Chance flipped inside a Flip Three can be used inside it and consumes a flip", () => {
  let r = game(P2, [2, 8, "flip_three", "second_chance", 2, 9, 10]);
  r = act(r, "p2", "hit"); // flip_three -> choose target (p1, p2 active)
  r = act(r, "p2", "target:p2");
  assert.deepEqual(line(r, "p2").numbers, [2, 9]);
  assert.equal(line(r, "p2").secondChance, false);
  assert.equal(types(r).filter((t) => t === "flip_three_card").length, 3);
  assert.ok(types(r).includes("second_chance_saved"));
  assert.equal(r.state.deck[0], 10);
});

test("set-aside Freeze and Flip Three are resolved after the three, in flip order, by the flipper", () => {
  let r = game(P3, [1, 2, 3, "flip_three", "freeze", "flip_three", 5, 6, 7, 8, 9]);
  r = act(r, "p2", "hit");
  r = act(r, "p2", "target:p2"); // p2 flips freeze(set aside), flip_three(set aside), 5
  assert.deepEqual(line(r, "p2").numbers, [1, 5]);
  assert.deepEqual(r.state.round.pending, { type: "choose_target", player: "p2", card: "freeze", candidates: ["p1", "p2", "p3"] });
  // only the first set-aside card has become a frame; the second waits in the parent continuation
  assert.equal(r.state.round.resolution.length, 2);
  assert.deepEqual(r.state.round.resolution[0], { card: "flip_three", drawer: "p2", target: "p2", remaining: 0, setAside: ["flip_three"], ended: true });
  assert.equal(r.state.round.resolution[1].card, "freeze");
  r = act(r, "p2", "target:p1");
  assert.equal(line(r, "p1").status, "frozen");
  assert.deepEqual(r.state.round.pending, { type: "choose_target", player: "p2", card: "flip_three", candidates: ["p2", "p3"] });
  r = act(r, "p2", "target:p3");
  assert.deepEqual(line(r, "p3").numbers, [2, 6, 7, 8]);
  assert.equal(engine.pendingPlayer(r.state), "p3");
  assert.equal(r.state.deck[0], 9);
});

test("a set-aside Flip Three can nest a further set-aside (two frames deep)", () => {
  let r = game(P3, [1, 2, 3, "flip_three", "flip_three", 5, 6, "freeze", 7, 8, 9, 10]);
  r = act(r, "p2", "hit");
  r = act(r, "p2", "target:p2"); // flips flip_three(set aside), 5, 6
  assert.equal(r.state.round.pending.card, "flip_three");
  r = act(r, "p2", "target:p3"); // p3 flips freeze(set aside), 7, 8 ; then chooses freeze target
  assert.deepEqual(line(r, "p3").numbers, [2, 7, 8]);
  assert.deepEqual(r.state.round.pending, { type: "choose_target", player: "p3", card: "freeze", candidates: ["p1", "p2", "p3"] });
  r = act(r, "p3", "target:p1");
  assert.equal(line(r, "p1").status, "frozen");
  assert.equal(engine.pendingPlayer(r.state), "p3");
});

test("a set-aside Freeze on the chooser does not stop the chooser assigning the next set-aside", () => {
  let r = game(P3, [1, 2, 3, "flip_three", "freeze", "flip_three", 5, 6, 7, 8]);
  r = act(r, "p2", "hit");
  r = act(r, "p2", "target:p2");
  r = act(r, "p2", "target:p2"); // freezes self
  assert.equal(line(r, "p2").status, "frozen");
  assert.deepEqual(r.state.round.pending, { type: "choose_target", player: "p2", card: "flip_three", candidates: ["p1", "p3"] });
});

test("the round can end during the deal when everyone is frozen", () => {
  let r = game(P2, ["freeze", "freeze", 5]);
  r = act(r, "p2", "target:p2"); // p2 frozen; p1 dealt freeze -> only active -> self
  assert.equal(r.state.phase, "round_over");
  assert.equal(r.state.round.results.p1.roundScore, 0);
  assert.equal(r.state.round.results.p2.roundScore, 0);
  assert.equal(r.state.deck[0], 5);
});

test("play resumes at the deal cursor after a deal-time Flip Three", () => {
  let r = game(P3, ["flip_three", 1, 2, 3, 4, 5, 6]);
  r = act(r, "p2", "target:p2");
  assert.deepEqual(line(r, "p2").numbers, [1, 2, 3]);
  assert.deepEqual(line(r, "p3").numbers, [4]);
  assert.deepEqual(line(r, "p1").numbers, [5]);
  assert.equal(engine.pendingPlayer(r.state), "p2");
  assert.equal(r.state.deck[0], 6);
});

test("a reshuffle can happen inside a Flip Three", () => {
  let r = engine.step(engine.createGame({ players: P2, seed: 3, deck: [1, 8, 1, "flip_three", 2] }), { type: "start_round" });
  r = act(r, "p2", "hit"); // duplicate 1 -> bust; discard [1,1]
  r = act(r, "p1", "hit"); // flip_three, only active -> self; flips 2, then reshuffles [1,1,flip_three]
  assert.ok(types(r).includes("reshuffle"));
  assert.equal(r.events.find((e) => e.type === "reshuffle").count, 3);
  // Whatever order the reshuffle yields, p1 (holding 8 and 2) eventually flips both 1s and busts.
  assert.equal(line(r, "p1").status, "busted");
  assert.equal(r.state.phase, "round_over", "no active players remain");
  assert.equal(r.state.round.resolution.length, 0);
});

test("a player whose only dealt card was given away has an empty line and may stay for zero", () => {
  let r = game(P3, ["freeze", 6, 8, 9]);
  r = act(r, "p2", "target:p1"); // p2 gives their dealt Freeze to p1
  assert.deepEqual(line(r, "p2").numbers, []);
  assert.equal(line(r, "p1").status, "frozen");
  assert.deepEqual(line(r, "p3").numbers, [6]);
  assert.equal(engine.pendingPlayer(r.state), "p2");
  assert.deepEqual(engine.legalActions(r.state), ["hit", "stay"]);
  r = act(r, "p2", "stay");
  assert.equal(line(r, "p2").status, "stayed");
  r = act(r, "p3", "stay");
  assert.equal(r.state.phase, "round_over");
  assert.equal(r.state.round.results.p2.roundScore, 0);
  assert.equal(r.state.round.results.p1.roundScore, 0, "frozen before being dealt");
  assert.equal(r.state.deck[0], 8, "p1 was skipped by the deal");
});

test("at round end lines are discarded in seat order: numbers ascending, modifiers, Second Chance", () => {
  let r = game(P2, [9, "x2", "second_chance", 4, "+4", 2]);
  // p2: 9 ; p1: x2
  r = act(r, "p2", "hit"); // second_chance kept
  r = act(r, "p1", "hit"); // 4
  r = act(r, "p2", "hit"); // +4
  r = act(r, "p1", "hit"); // 2
  r = act(r, "p2", "stay");
  r = act(r, "p1", "stay");
  assert.equal(r.state.phase, "round_over");
  assert.deepEqual(r.state.discard, [2, 4, "x2", 9, "+4", "second_chance"]);
  assert.equal(r.state.round.results.p1.roundScore, 12);
  assert.equal(r.state.round.results.p2.roundScore, 13);
});

test("deck exhaustion inside a Flip Three ends the sequence early", () => {
  let r = engine.step(engine.createGame({ players: P2, seed: 1, deck: [1, 8, "flip_three", 2] }), { type: "start_round" });
  r = act(r, "p2", "hit"); // flip_three -> choose target (both active)
  r = act(r, "p2", "target:p2"); // flips 2; the deck is empty and the discard holds only the Flip Three itself
  assert.ok(!types(r).includes("reshuffle"), "a discard of only action cards is not reshuffled");
  assert.deepEqual(types(r).filter((t) => t !== "flip_three_started"), ["flip_three_card", "deck_exhausted", "flip_three_ended"]);
  assert.deepEqual(line(r, "p2").numbers, [1, 2]);
  assert.equal(line(r, "p2").status, "active");
  assert.equal(r.state.round.resolution.length, 0);
  assert.equal(engine.pendingPlayer(r.state), "p1");
});

test("a deal-time Flip Three that completes Flip 7 ends the round before the remaining seats are dealt", () => {
  let r = game(P3, [1, "flip_three", 2, 3, 4, "flip_three", 5, 6, 7, 12]);
  // p2 dealt 1; p3 dealt flip_three -> choose target
  assert.equal(r.state.round.pending.player, "p3");
  r = act(r, "p3", "target:p2"); // p2 flips 2,3,4 -> p2 has 1..4 ; play returns to the deal cursor: p1 dealt flip_three
  assert.deepEqual(line(r, "p2").numbers, [1, 2, 3, 4]);
  assert.deepEqual(r.state.round.pending, { type: "choose_target", player: "p1", card: "flip_three", candidates: ["p1", "p2", "p3"] });
  r = act(r, "p1", "target:p2"); // 5,6,7 -> Flip 7
  assert.equal(r.state.phase, "round_over");
  assert.deepEqual(r.state.round.results.p2, { roundScore: 43, flip7: true });
  assert.deepEqual(line(r, "p1").numbers, [], "p1 was never dealt a number");
  assert.equal(r.state.deck[0], 12);
});
