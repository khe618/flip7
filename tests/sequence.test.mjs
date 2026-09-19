import test from "node:test";
import assert from "node:assert/strict";
import { newEvents, cardKind } from "../public/js/sequence.js";

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
