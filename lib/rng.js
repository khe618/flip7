"use strict";

// FNV-1a 32-bit hash of a string.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function seedState(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) return (seed >>> 0) || 0x9e3779b9;
  return fnv1a(String(seed)) || 0x9e3779b9;
}

// mulberry32: one step. Pure: returns the new state instead of mutating.
function next(state) {
  const t = (state + 0x6d2b79f5) >>> 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  const value = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  return { value, state: t };
}

function shuffle(cards, state) {
  const out = cards.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    const r = next(s);
    s = r.state;
    const j = Math.floor(r.value * (i + 1));
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return { cards: out, state: s };
}

function createRandom(seed) {
  let s = seedState(seed);
  return () => { const r = next(s); s = r.state; return r.value; };
}

module.exports = { fnv1a, seedState, next, shuffle, createRandom };
