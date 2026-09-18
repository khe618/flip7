"use strict";

const MODIFIERS = ["+2", "+4", "+6", "+8", "+10", "x2"];
const ACTIONS = ["freeze", "flip_three", "second_chance"];
const FLIP7_BONUS = 15;

function buildDeck() {
  const deck = [0];
  for (let n = 1; n <= 12; n++) for (let k = 0; k < n; k++) deck.push(n);
  for (const m of MODIFIERS) deck.push(m);
  for (const a of ACTIONS) for (let k = 0; k < 3; k++) deck.push(a);
  return deck;
}

function isNumber(c) { return Number.isInteger(c) && c >= 0 && c <= 12; }
function isModifier(c) { return MODIFIERS.includes(c); }
function isAction(c) { return ACTIONS.includes(c); }
function cardKey(c) { return String(c); }

function cardCounts() {
  const counts = {};
  for (const c of buildDeck()) counts[cardKey(c)] = (counts[cardKey(c)] || 0) + 1;
  return counts;
}

function roundScore(line, flip7) {
  let sum = 0;
  for (const n of line.numbers) sum += n;
  if (line.modifiers.includes("x2")) sum *= 2;
  for (const m of line.modifiers) if (m !== "x2") sum += Number.parseInt(m, 10);
  if (flip7) sum += FLIP7_BONUS;
  return sum;
}

module.exports = { MODIFIERS, ACTIONS, FLIP7_BONUS, buildDeck, isNumber, isModifier, isAction, cardKey, cardCounts, roundScore };
