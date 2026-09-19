import test from "node:test";
import assert from "node:assert/strict";
import { newEvents, cardKind, planSteps } from "../public/js/sequence.js";

const ev = (type, fields = {}) => ({ type, turnNumber: 1, ...fields });
const game = (history, history_start, extra = {}) => ({ history, history_start, turnNumber: 1, players: [], ...extra });

test("newEvents: a null cursor resets and moves the cursor to the end of the window", () => {
  const r = newEvents(null, game([ev("round_started"), ev("dealt", { player: "a", card: 5 })], 0));
  assert.deepEqual(r, { events: [], reset: true, cursor: 2 });
});

test("newEvents: a cursor inside the window returns exactly the unseen tail", () => {
  const h = [ev("round_started"), ev("dealt", { player: "a", card: 5 }), ev("hit", { player: "a", card: 7 })];
  const r = newEvents(1, game(h, 0));
  assert.equal(r.reset, false);
  assert.deepEqual(r.events, h.slice(1));
  assert.equal(r.cursor, 3);
});

test("newEvents: a cursor at the end returns nothing (repeated snapshot)", () => {
  const h = [ev("round_started"), ev("dealt", { player: "a", card: 5 })];
  assert.deepEqual(newEvents(2, game(h, 0)), { events: [], reset: false, cursor: 2 });
});

test("newEvents: a window that slid past the cursor resets", () => {
  const h = Array.from({ length: 40 }, (_, i) => ev("hit", { player: "a", card: i }));
  const r = newEvents(3, game(h, 10));
  assert.deepEqual(r, { events: [], reset: true, cursor: 50 });
});

test("newEvents: a full 40-event window that slid by one returns exactly one event", () => {
  const h = Array.from({ length: 40 }, (_, i) => ev("hit", { player: "a", card: i + 1 }));
  const r = newEvents(40, game(h, 1));
  assert.equal(r.reset, false);
  assert.deepEqual(r.events, [h[39]]);
  assert.equal(r.cursor, 41);
});

test("newEvents: identical repeated events are not confused because indices, not content, are compared", () => {
  const h = [ev("flip_three_card", { player: "a", card: "freeze" }), ev("set_aside", { player: "a", card: "freeze" }), ev("flip_three_card", { player: "a", card: "freeze" }), ev("set_aside", { player: "a", card: "freeze" })];
  const r = newEvents(2, game(h, 0));
  assert.deepEqual(r.events, h.slice(2));
});

test("newEvents: a new round continues from the cursor without a reset", () => {
  // round 1 occupied absolute indices 0..4, round 2 starts at 5
  const h = [ev("round_started", { roundNumber: 2 }), ev("dealt", { player: "a", card: 2 })];
  const r = newEvents(5, game(h, 5));
  assert.deepEqual(r, { events: h, reset: false, cursor: 7 });
});

test("cardKind classifies numbers, modifiers, and actions", () => {
  assert.equal(cardKind(0), "number");
  assert.equal(cardKind(12), "number");
  assert.equal(cardKind("x2"), "modifier");
  assert.equal(cardKind("+10"), "modifier");
  for (const a of ["freeze", "flip_three", "second_chance"]) assert.equal(cardKind(a), "action");
});

const kinds = (steps) => steps.map((s) => s.kind);
const names = { a: "Ann", b: "Bo" };
const opts = { you: "a", nameOf: (id) => names[id] || id };
const g1 = (turnNumber = 4) => game([], 0, { turnNumber });

test("planSteps: a number hit reveals, rests, sorts, then ends with a barrier carrying the turn number", () => {
  const steps = planSteps([ev("hit", { player: "a", card: 7 })], g1(4), opts);
  assert.deepEqual(kinds(steps), ["press-deck", "travel", "flip", "rest", "sort", "barrier"]);
  assert.deepEqual(steps.map((s) => s.ms), [70, 240, 190, 220, 160, 0]);
  assert.equal(steps.at(-1).turnNumber, 4);
  assert.equal(steps[2].tier, "consequential");
  assert.equal(steps[2].min, 120);
  assert.equal(steps[1].card, 7);
  assert.equal(steps[1].player, "a");
});

test("planSteps: a modifier hit adds a cosmetic score roll", () => {
  const steps = planSteps([ev("hit", { player: "a", card: "+4" })], g1(), opts);
  assert.deepEqual(kinds(steps), ["press-deck", "travel", "flip", "rest", "sort", "score-roll", "barrier"]);
  assert.equal(steps[5].tier, "cosmetic");
});

test("planSteps: an action hit holds at the hand then goes to discard before its consequence", () => {
  const steps = planSteps([ev("hit", { player: "a", card: "freeze" }), ev("freeze", { from: "a", to: "b" })], g1(), opts);
  assert.deepEqual(kinds(steps), ["press-deck", "travel", "flip", "hold", "to-discard", "freeze-sweep", "barrier"]);
  assert.equal(steps[3].ms, 450);
  assert.equal(steps[3].min, 250);
  assert.deepEqual([steps[5].from, steps[5].to], ["a", "b"]);
  assert.match(steps[5].caption, /Bo/);
});

test("planSteps: a dealt action card also follows the action path (a target decision may follow)", () => {
  const steps = planSteps([ev("dealt", { player: "b", card: "flip_three" })], g1(), opts);
  assert.deepEqual(kinds(steps), ["travel", "flip", "hold", "to-discard", "beat", "barrier"]);
  assert.equal(steps[4].ms, 110, "deal stagger");
});

test("planSteps: bust shows the duplicate pair, shakes, holds, then sweeps; no rest/sort for the busting card", () => {
  const steps = planSteps([ev("hit", { player: "a", card: 8 }), ev("bust", { player: "a", card: 8 })], g1(), opts);
  assert.deepEqual(kinds(steps), ["press-deck", "travel", "flip", "pair", "shake", "hold", "sweep", "barrier"]);
  const pair = steps[3], hold = steps[5], sweep = steps[6];
  assert.ok(kinds(steps).indexOf("pair") < kinds(steps).indexOf("sweep"), "the duplicate is shown before the line is cleared");
  assert.equal(pair.ms, 500); assert.equal(steps[4].ms, 280); assert.equal(hold.ms, 550); assert.equal(sweep.ms, 320);
  assert.equal(pair.min + hold.min, 600, "bust readability floor");
  assert.equal(pair.card, 8);
  assert.equal(pair.caption, "BUST · duplicate 8");
  assert.equal(sweep.min, 120);
});

test("planSteps: a Second Chance save shows the pair, flashes the shield, and discards both", () => {
  const steps = planSteps([ev("hit", { player: "a", card: 3 }), ev("second_chance_saved", { player: "a", card: 3 })], g1(), opts);
  assert.deepEqual(kinds(steps), ["press-deck", "travel", "flip", "pair", "shield-flash", "to-discard", "barrier"]);
  assert.equal(steps[3].ms, 400); assert.equal(steps[3].min, 400, "the Second Chance pair is never compressed below 400");
  assert.equal(steps[4].ms, 300); assert.equal(steps[4].min, 150);
  assert.equal(steps[3].caption, "SECOND CHANCE");
});

test("planSteps: a kept Second Chance lands as a token and is never sent to discard", () => {
  const steps = planSteps([ev("hit", { player: "a", card: "second_chance" }), ev("second_chance_kept", { player: "a" })], g1(), opts);
  assert.deepEqual(kinds(steps), ["press-deck", "travel", "flip", "hold", "to-token", "token-land", "barrier"]);
  assert.equal(steps[4].ms, 220);
});

test("planSteps: a second Second Chance goes to discard, then arcs to the receiver or is discarded", () => {
  const steps = planSteps([
    ev("hit", { player: "a", card: "second_chance" }), ev("second_chance_given", { from: "a", to: "b" }),
    ev("hit", { player: "a", card: "second_chance" }), ev("second_chance_discarded", { player: "a" }),
  ], g1(), opts);
  assert.deepEqual(kinds(steps), [
    "press-deck", "travel", "flip", "hold", "to-discard", "token-arc",
    "press-deck", "travel", "flip", "hold", "to-discard", "caption",
    "barrier",
  ]);
  assert.deepEqual([steps[5].from, steps[5].to], ["a", "b"]);
});

test("planSteps: Flip Three reveals three cards sequentially with a rest and a beat between each", () => {
  const steps = planSteps([
    ev("hit", { player: "a", card: "flip_three" }), ev("flip_three_started", { from: "a", to: "b" }),
    ev("flip_three_card", { player: "b", card: 2 }), ev("flip_three_card", { player: "b", card: 9 }), ev("flip_three_card", { player: "b", card: "+2" }),
    ev("flip_three_ended", { player: "b" }),
  ], g1(), opts);
  const k = kinds(steps);
  assert.deepEqual(k.slice(0, 6), ["press-deck", "travel", "flip", "hold", "to-discard", "pips-set"]);
  const per = ["press-deck", "travel", "flip", "rest", "sort", "beat", "pip-remove"];
  assert.deepEqual(k.slice(6, 13), per);
  assert.deepEqual(k.slice(13, 20), per);
  assert.deepEqual(k.slice(20, 28), ["press-deck", "travel", "flip", "rest", "sort", "score-roll", "beat", "pip-remove"]);
  assert.deepEqual(k.slice(28), ["pips-clear", "barrier"]);
  assert.equal(steps[9].kind, "rest"); assert.equal(steps[9].ms, 300, "Flip Three hold is 300");
  assert.equal(steps[11].ms, 140, "beat between Flip Three cards");
  assert.equal(k.filter((x) => x === "flip").length, 4, "three reveals plus the action card");
});

test("planSteps: an action drawn during Flip Three parks beside the discard, then resolves after flip_three_ended", () => {
  const steps = planSteps([
    ev("flip_three_card", { player: "b", card: "freeze" }), ev("set_aside", { player: "b", card: "freeze" }),
    ev("flip_three_card", { player: "b", card: 4 }),
    ev("flip_three_ended", { player: "b" }),
    ev("freeze", { from: "b", to: "a" }),
  ], g1(), opts);
  const k = kinds(steps);
  assert.deepEqual(k.slice(0, 6), ["press-deck", "travel", "flip", "hold", "park", "beat"]);
  assert.ok(k.indexOf("pips-clear") < k.indexOf("freeze-sweep"), "parked card resolves after the frame ends");
  assert.equal(k.filter((x) => x === "to-discard").length, 0, "the parked card is not sent to discard by the reveal");
});

test("planSteps: a Second Chance save inside Flip Three uses the same pair steps, then the Flip Three postlude", () => {
  const steps = planSteps([ev("flip_three_card", { player: "b", card: 5 }), ev("second_chance_saved", { player: "b", card: 5 })], g1(), opts);
  assert.deepEqual(kinds(steps), ["press-deck", "travel", "flip", "pair", "shield-flash", "to-discard", "beat", "pip-remove", "barrier"]);
});

test("planSteps: a bust inside Flip Three shows the pair and sweeps before the postlude and the frame end", () => {
  const steps = planSteps([ev("flip_three_card", { player: "b", card: 5 }), ev("bust", { player: "b", card: 5 }), ev("flip_three_ended", { player: "b" })], g1(), opts);
  assert.deepEqual(kinds(steps), ["press-deck", "travel", "flip", "pair", "shake", "hold", "sweep", "beat", "pip-remove", "pips-clear", "barrier"]);
});

test("planSteps: a dealt card that busts (a duplicate on the deal is impossible, but a dealt action still gets the deal beat after its consequence)", () => {
  const steps = planSteps([ev("dealt", { player: "a", card: "second_chance" }), ev("second_chance_kept", { player: "a" })], g1(), opts);
  assert.deepEqual(kinds(steps), ["travel", "flip", "hold", "to-token", "token-land", "beat", "barrier"]);
});

test("planSteps: deck exhausted then a forced stay captions the bank", () => {
  const steps = planSteps([ev("deck_exhausted", { player: "a" }), ev("stay", { player: "a" })], g1(), opts);
  assert.deepEqual(kinds(steps), ["caption", "banked-stamp", "barrier"]);
  assert.equal(steps[1].caption, "No cards left · banked");
  assert.equal(steps[1].tier, "cosmetic");
});

test("planSteps: stay, flip7, round_started, reshuffle", () => {
  const steps = planSteps([
    ev("round_started", { roundNumber: 2, dealer: "b" }), ev("reshuffle", { count: 30 }),
    ev("stay", { player: "b" }), ev("hit", { player: "a", card: 11 }), ev("flip7", { player: "a" }),
  ], g1(), opts);
  assert.deepEqual(kinds(steps), ["round-start", "reshuffle", "banked-stamp", "press-deck", "travel", "flip", "rest", "sort", "notches", "flip7-ring", "barrier"]);
  assert.equal(steps[0].caption, "Round 2 · Bo deals");
  assert.equal(steps[9].caption, "FLIP 7 +15");
  assert.equal(steps[9].ms, 900); assert.equal(steps[9].min, 400); assert.equal(steps[9].tier, "consequential");
  assert.equal(steps[8].ms, 350); assert.equal(steps[8].tier, "cosmetic");
});

test("planSteps: round_ended then game_over in one snapshot orders the sheet before the results", () => {
  const steps = planSteps([ev("stay", { player: "a" }), ev("round_ended", { results: {} }), ev("game_over", { winner: "a" })], g1(9), opts);
  assert.deepEqual(kinds(steps), ["banked-stamp", "sheet", "results", "barrier"]);
  assert.equal(steps[1].ms, 900); assert.equal(steps[1].min, 300);
  assert.equal(steps[2].ms, 1500); assert.equal(steps[2].min, 700);
  assert.equal(steps.at(-1).turnNumber, 9);
});

test("planSteps: reduced motion removes travel/shake/sweep/score-roll/token-arc and keeps holds", () => {
  const steps = planSteps([ev("hit", { player: "a", card: 8 }), ev("bust", { player: "a", card: 8 })], g1(), { ...opts, reducedMotion: true });
  const byKind = Object.fromEntries(steps.map((s) => [s.kind, s.ms]));
  assert.equal(byKind.travel, 0); assert.equal(byKind.shake, 0); assert.equal(byKind.sweep, 0); assert.equal(byKind["press-deck"], 0);
  assert.equal(byKind.flip, 120, "flip becomes the 120 ms colour emphasis");
  assert.equal(byKind.pair, 500); assert.equal(byKind.hold, 550);
});

test("planSteps: an empty event list still yields the barrier", () => {
  assert.deepEqual(kinds(planSteps([], g1(2), opts)), ["barrier"]);
});
