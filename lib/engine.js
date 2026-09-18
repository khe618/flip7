"use strict";
const rng = require("./rng");
const cards = require("./cards");

class IllegalAction extends Error {
  constructor(message) { super(message); this.name = "IllegalAction"; }
}

function emptyLine() { return { numbers: [], modifiers: [], secondChance: false, status: "active" }; }
function emptyRound() {
  return { lines: {}, dealCursor: null, turnSeat: null, pending: null, resolution: [], results: null };
}

function createGame({ players, seed, targetScore = 200, deck = null }) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 6) throw new Error("players must have 2 to 6 entries");
  if (new Set(players.map((p) => p.id)).size !== players.length) throw new Error("player ids must be unique");
  let rngState = rng.seedState(seed);
  let initialDeck;
  if (deck) initialDeck = deck.slice();
  else { const r = rng.shuffle(cards.buildDeck(), rngState); initialDeck = r.cards; rngState = r.state; }
  return {
    seed, rngState, targetScore,
    players: players.map((p, i) => ({ id: p.id, name: p.name, seat: i, score: 0 })),
    dealerSeat: 0, roundNumber: 0, turnNumber: 0, phase: "lobby",
    deck: initialDeck, discard: [], round: emptyRound(), winner: null, history: [],
  };
}

function legalActions(state) {
  const p = state.round.pending;
  if (!p) return [];
  if (p.type === "hit_or_stay") return ["hit", "stay"];
  return p.candidates.map((id) => "target:" + id);
}

function pendingPlayer(state) { return state.round.pending ? state.round.pending.player : null; }

function step(state, input) {
  const s = structuredClone(state);
  const ctx = { s, events: [] };
  if (input.type === "start_round") {
    if (s.phase !== "lobby" && s.phase !== "round_over") throw new IllegalAction(`cannot start a round in phase ${s.phase}`);
    startRound(ctx);
  } else if (input.type === "act") {
    const p = s.round.pending;
    if (!p) throw new IllegalAction("no decision pending");
    if (p.player !== input.player) throw new IllegalAction(`decision belongs to ${p.player}`);
    const legal = legalActions(s);
    if (!legal.includes(input.action)) throw new IllegalAction(`illegal action "${input.action}"; legal: ${legal.join(", ")}`);
    applyAction(ctx, input.action);
  } else {
    throw new IllegalAction(`unknown input type ${input && input.type}`);
  }
  s.history.push(...ctx.events);
  return { state: s, events: ctx.events };
}

// ---- helpers -------------------------------------------------------------

function emit(ctx, type, fields) { ctx.events.push({ type, ...fields, turnNumber: ctx.s.turnNumber }); }
function playerAt(s, seat) { return s.players[seat]; }
function line(s, id) { return s.round.lines[id]; }
function activeIds(s) { return s.players.filter((p) => line(s, p.id).status === "active").map((p) => p.id); }
function nextActiveSeatAfter(s, seat) {
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const t = (seat + k) % n;
    if (line(s, playerAt(s, t).id).status === "active") return t;
  }
  return null;
}
function askDecision(ctx, pending) { ctx.s.turnNumber += 1; ctx.s.round.pending = pending; }

// ---- round flow ----------------------------------------------------------

function startRound(ctx) {
  const s = ctx.s;
  s.roundNumber += 1;
  s.phase = "round";
  s.round = emptyRound();
  for (const p of s.players) s.round.lines[p.id] = emptyLine();
  s.round.dealCursor = { nextSeat: (s.dealerSeat + 1) % s.players.length, remaining: s.players.length };
  emit(ctx, "round_started", { roundNumber: s.roundNumber, dealer: playerAt(s, s.dealerSeat).id });
  advance(ctx);
}

// Drive the game forward until a decision is needed or the round is over.
function advance(ctx) {
  const s = ctx.s;
  while (s.phase === "round" && !s.round.pending) {
    if (s.round.resolution.length > 0) { resolveTop(ctx); continue; }
    if (s.round.dealCursor) { dealNext(ctx); continue; }
    const seat = nextActiveSeatAfter(s, s.round.turnSeat);
    if (seat === null) { endRound(ctx); return; }
    s.round.turnSeat = seat;
    askDecision(ctx, { type: "hit_or_stay", player: playerAt(s, seat).id });
  }
}

function dealNext(ctx) {
  const s = ctx.s;
  const dc = s.round.dealCursor;
  if (dc.remaining === 0) { s.round.dealCursor = null; s.round.turnSeat = s.dealerSeat; return; }
  const seat = dc.nextSeat;
  dc.nextSeat = (seat + 1) % s.players.length;
  dc.remaining -= 1;
  const id = playerAt(s, seat).id;
  if (line(s, id).status !== "active") return;
  const card = draw(ctx, id);
  if (card === null) return;
  emit(ctx, "dealt", { player: id, card });
  receiveCard(ctx, id, card, false);
}

function draw(ctx, forPlayer) {
  const s = ctx.s;
  if (s.deck.length === 0) {
    // Reshuffling a discard pile that holds only action cards would just re-flip them forever
    // (unreachable with the real 94-card deck; keeps the engine finite for tiny test decks).
    if (!s.discard.some((c) => !cards.isAction(c))) { emit(ctx, "deck_exhausted", { player: forPlayer }); return null; }
    const r = rng.shuffle(s.discard, s.rngState);
    s.deck = r.cards; s.rngState = r.state; s.discard = [];
    emit(ctx, "reshuffle", { count: s.deck.length });
  }
  return s.deck.shift();
}

function receiveCard(ctx, id, card, fromFlipThree) {
  const s = ctx.s;
  const l = line(s, id);
  if (cards.isNumber(card)) {
    if (l.numbers.includes(card)) {
      if (l.secondChance) {
        l.secondChance = false;
        s.discard.push("second_chance", card);
        emit(ctx, "second_chance_saved", { player: id, card });
        return;
      }
      emit(ctx, "bust", { player: id, card });
      s.discard.push(...l.numbers, ...l.modifiers, card);
      l.numbers = []; l.modifiers = []; l.status = "busted";
      return;
    }
    l.numbers.push(card);
    l.numbers.sort((a, b) => a - b);
    if (l.numbers.length === 7) { emit(ctx, "flip7", { player: id }); endRound(ctx); }
    return;
  }
  if (cards.isModifier(card)) { l.modifiers.push(card); return; }
  if (card === "second_chance") {
    if (!l.secondChance) { l.secondChance = true; emit(ctx, "second_chance_kept", { player: id }); return; }
    // Already holding one: the card sits in the discard until it is given away.
    s.discard.push(card);
    const candidates = activeIds(s).filter((q) => q !== id && !line(s, q).secondChance);
    if (candidates.length === 0) { emit(ctx, "second_chance_discarded", { player: id }); return; }
    s.round.resolution.push({ card, drawer: id, target: null, remaining: 0, setAside: [], ended: false });
    return;
  }
  // freeze or flip_three: discard on flip, resolve via the stack.
  s.discard.push(card);
  const top = s.round.resolution[s.round.resolution.length - 1];
  if (fromFlipThree && top && top.card === "flip_three" && top.target === id) {
    top.setAside.push(card);
    emit(ctx, "set_aside", { player: id, card });
    return;
  }
  s.round.resolution.push({ card, drawer: id, target: null, remaining: card === "flip_three" ? 3 : 0, setAside: [], ended: false });
}

function candidatesFor(s, f) {
  const active = activeIds(s);
  if (f.card === "second_chance") return active.filter((q) => q !== f.drawer && !line(s, q).secondChance);
  return active;
}

function setTarget(ctx, f, target) {
  f.target = target;
  if (f.card === "freeze") emit(ctx, "freeze", { from: f.drawer, to: target });
  else if (f.card === "flip_three") emit(ctx, "flip_three_started", { from: f.drawer, to: target });
  else emit(ctx, "second_chance_given", { from: f.drawer, to: target });
}

// One step of resolving the top frame. Called repeatedly by advance().
function resolveTop(ctx) {
  const s = ctx.s;
  const stack = s.round.resolution;
  const f = stack[stack.length - 1];
  if (f.target === null) {
    const candidates = candidatesFor(s, f);
    if (candidates.length === 0) {
      stack.pop();
      if (f.card === "second_chance") emit(ctx, "second_chance_discarded", { player: f.drawer });
      return;
    }
    if (candidates.length > 1) {
      askDecision(ctx, { type: "choose_target", player: f.drawer, card: f.card, candidates });
      return;
    }
    setTarget(ctx, f, candidates[0]);
  }
  const t = line(s, f.target);
  if (f.card === "freeze") { t.status = "frozen"; stack.pop(); return; }
  if (f.card === "second_chance") {
    s.discard.splice(s.discard.lastIndexOf("second_chance"), 1);
    t.secondChance = true;
    stack.pop();
    return;
  }
  // flip_three
  if (f.remaining > 0 && t.status === "active") {
    const card = draw(ctx, f.target);
    if (card === null) { f.remaining = 0; return; }
    f.remaining -= 1;
    emit(ctx, "flip_three_card", { player: f.target, card });
    receiveCard(ctx, f.target, card, true);
    return;
  }
  if (s.phase !== "round") return; // round ended mid-sequence; endRound cleared the stack
  if (!f.ended) {
    // The three flips are done (or stopped early). The frame stays on the stack as a
    // continuation while its set-aside cards resolve one at a time, in flip order.
    f.ended = true;
    f.remaining = 0;
    emit(ctx, "flip_three_ended", { player: f.target });
    if (t.status !== "active") f.setAside = [];   // busted: set-asides are dropped
    return;
  }
  if (f.setAside.length === 0) { stack.pop(); return; }
  const card = f.setAside.shift();
  stack.push({ card, drawer: f.target, target: null, remaining: card === "flip_three" ? 3 : 0, setAside: [], ended: false });
}

function applyAction(ctx, action) {
  const s = ctx.s;
  const p = s.round.pending;
  s.round.pending = null;
  if (p.type === "hit_or_stay") {
    if (action === "stay") {
      line(s, p.player).status = "stayed";
      emit(ctx, "stay", { player: p.player });
    } else {
      const card = draw(ctx, p.player);
      if (card === null) { line(s, p.player).status = "stayed"; emit(ctx, "stay", { player: p.player }); }
      else { emit(ctx, "hit", { player: p.player, card }); receiveCard(ctx, p.player, card, false); }
    }
  } else {
    const f = s.round.resolution[s.round.resolution.length - 1];
    setTarget(ctx, f, action.slice("target:".length));
  }
  advance(ctx);
}

function endRound(ctx) {
  const s = ctx.s;
  const results = {};
  for (const p of s.players) {
    const l = line(s, p.id);
    const flip7 = l.numbers.length === 7;
    const roundScore = l.status === "busted" ? 0 : cards.roundScore(l, flip7);
    results[p.id] = { roundScore, flip7 };
    p.score += roundScore;
  }
  for (const p of s.players) {
    const l = line(s, p.id);
    s.discard.push(...l.numbers, ...l.modifiers);
    if (l.secondChance) s.discard.push("second_chance");
    l.numbers = []; l.modifiers = []; l.secondChance = false;
  }
  s.round.pending = null; s.round.resolution = []; s.round.dealCursor = null; s.round.turnSeat = null;
  s.round.results = results;
  s.phase = "round_over";
  emit(ctx, "round_ended", { results });
  const top = Math.max(...s.players.map((p) => p.score));
  const leaders = s.players.filter((p) => p.score === top);
  if (top >= s.targetScore && leaders.length === 1) {
    s.phase = "game_over";
    s.winner = leaders[0].id;
    emit(ctx, "game_over", { winner: s.winner, scores: Object.fromEntries(s.players.map((p) => [p.id, p.score])) });
  } else {
    s.dealerSeat = (s.dealerSeat + 1) % s.players.length;
  }
}

module.exports = { createGame, step, legalActions, pendingPlayer, IllegalAction };
