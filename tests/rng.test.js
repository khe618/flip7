"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const rng = require("../lib/rng");

test("fnv1a is stable and 32-bit", () => {
  assert.equal(rng.fnv1a(""), 0x811c9dc5);
  assert.equal(rng.fnv1a("a"), 0xe40c292c);
  assert.equal(rng.fnv1a("standard:0"), rng.fnv1a("standard:0"));
  assert.notEqual(rng.fnv1a("standard:0"), rng.fnv1a("standard:1"));
});

test("next is deterministic and in [0,1)", () => {
  let s = rng.seedState(42);
  const a = [];
  for (let i = 0; i < 5; i++) { const r = rng.next(s); a.push(r.value); s = r.state; }
  let t = rng.seedState(42);
  const b = [];
  for (let i = 0; i < 5; i++) { const r = rng.next(t); b.push(r.value); t = r.state; }
  assert.deepEqual(a, b);
  for (const v of a) assert.ok(v >= 0 && v < 1);
  assert.equal(new Set(a).size, 5);
});

test("string and numeric seeds both work and differ", () => {
  assert.notEqual(rng.seedState("alpha"), rng.seedState("beta"));
  assert.equal(rng.seedState(7), rng.seedState(7));
});

test("shuffle is a permutation, deterministic, and leaves the input alone", () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const a = rng.shuffle(input, rng.seedState(1));
  const b = rng.shuffle(input, rng.seedState(1));
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(a.cards, b.cards);
  assert.deepEqual([...a.cards].sort((x, y) => x - y), input);
  assert.notDeepEqual(a.cards, input);
  assert.notEqual(a.state, rng.seedState(1));
});

test("createRandom yields the same stream as next", () => {
  const r = rng.createRandom(99);
  let s = rng.seedState(99);
  for (let i = 0; i < 3; i++) { const n = rng.next(s); assert.equal(r(), n.value); s = n.state; }
});
