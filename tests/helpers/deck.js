"use strict";
const cards = require("../../lib/cards");

// Returns a full 94-card deck whose first cards are `top`, followed by every
// remaining card in canonical order. Throws if `top` uses more copies of a
// card than the deck holds.
function deckFrom(top) {
  const remaining = cards.cardCounts();
  for (const c of top) {
    const k = cards.cardKey(c);
    if (!remaining[k]) throw new Error(`deckFrom: too many copies of ${k}`);
    remaining[k] -= 1;
  }
  const rest = cards.buildDeck().filter((c) => {
    const k = cards.cardKey(c);
    if (remaining[k] > 0) { remaining[k] -= 1; return true; }
    return false;
  });
  return top.concat(rest);
}

module.exports = { deckFrom };
