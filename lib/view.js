"use strict";
const engine = require("./engine");
const cards = require("./cards");

const HISTORY_WINDOW = 40;
const EMPTY_LINE = { numbers: [], modifiers: [], secondChance: false, status: "active" };

// The secrecy boundary. Never copies state.deck, state.rngState, or state.seed.
function observeGame(state, playerId) {
  const s = state;
  const r = s.round;
  const pending = r.pending;
  const mine = pending && pending.player === playerId ? pending : null;
  const decision = !mine ? null
    : mine.type === "hit_or_stay" ? { type: "hit_or_stay" }
    : { type: "choose_target", card: mine.card, candidates: mine.candidates.slice() };
  let start = -1;
  for (let i = s.history.length - 1; i >= 0; i--) if (s.history[i].type === "round_started") { start = i; break; }
  const roundEvents = start >= 0 ? s.history.slice(start) : [];
  return {
    phase: s.phase,
    round: s.roundNumber,
    turnNumber: s.turnNumber,
    you: playerId,
    target_score: s.targetScore,
    dealer: s.players[s.dealerSeat].id,
    current_player: pending ? pending.player : null,
    decision,
    legal_actions: mine ? engine.legalActions(s) : [],
    players: s.players.map((p) => {
      const l = r.lines[p.id] || EMPTY_LINE;
      return {
        id: p.id, name: p.name, seat: p.seat, score: p.score, status: l.status,
        numbers: l.numbers.slice(), modifiers: l.modifiers.slice(), second_chance: l.secondChance,
        round_score: cards.roundScore(l, l.numbers.length === 7), unique_count: l.numbers.length,
      };
    }),
    deck_remaining: s.deck.length,
    discard: s.discard.slice(),
    resolution: r.resolution.map((f) => ({ card: f.card, drawer: f.drawer, target: f.target, remaining: f.remaining, setAside: f.setAside.slice(), ended: f.ended })),
    results: r.results ? structuredClone(r.results) : null,
    winner: s.winner,
    history: roundEvents.slice(-HISTORY_WINDOW).map((e) => structuredClone(e)),
  };
}

// Cards not in any line and not in the discard are exactly the deck (spec §2.3).
function unseenCounts(view) {
  const counts = cards.cardCounts();
  const take = (c) => { counts[cards.cardKey(c)] -= 1; };
  for (const c of view.discard) take(c);
  for (const p of view.players) {
    for (const c of p.numbers) take(c);
    for (const c of p.modifiers) take(c);
    if (p.second_chance) take("second_chance");
  }
  return counts;
}

module.exports = { observeGame, unseenCounts, HISTORY_WINDOW };
