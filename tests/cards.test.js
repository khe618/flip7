"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const cards = require("../lib/cards");

test("deck has 94 cards with the exact composition", () => {
  const deck = cards.buildDeck();
  assert.equal(deck.length, 94);
  const counts = {};
  for (const c of deck) counts[cards.cardKey(c)] = (counts[cards.cardKey(c)] || 0) + 1;
  assert.equal(counts["0"], 1);
  for (let n = 1; n <= 12; n++) assert.equal(counts[String(n)], n, `count of ${n}`);
  for (const m of cards.MODIFIERS) assert.equal(counts[m], 1);
  for (const a of cards.ACTIONS) assert.equal(counts[a], 3);
  assert.deepEqual(cards.cardCounts(), counts);
});

test("predicates classify every card", () => {
  assert.ok(cards.isNumber(0) && cards.isNumber(12));
  assert.ok(!cards.isNumber("x2"));
  assert.ok(cards.isModifier("x2") && cards.isModifier("+10"));
  assert.ok(!cards.isModifier("freeze"));
  assert.ok(cards.isAction("freeze") && cards.isAction("flip_three") && cards.isAction("second_chance"));
  for (const c of cards.buildDeck()) {
    assert.equal([cards.isNumber(c), cards.isModifier(c), cards.isAction(c)].filter(Boolean).length, 1);
  }
});

test("roundScore follows the spec §2.5 table", () => {
  const rows = [
    [[3, 7, 12], [], false, 22],
    [[3, 7, 12], ["x2"], false, 44],
    [[3, 7, 12], ["x2", "+4"], false, 48],
    [[0, 1, 2, 3, 4, 5, 6], ["+10"], true, 46],
    [[0, 1, 2, 3, 4, 5, 6], ["x2", "+10"], true, 67],
    [[], [], false, 0],
    [[], ["+4"], false, 4],
  ];
  for (const [numbers, modifiers, flip7, expected] of rows) {
    assert.equal(cards.roundScore({ numbers, modifiers }, flip7), expected, JSON.stringify([numbers, modifiers, flip7]));
  }
});
