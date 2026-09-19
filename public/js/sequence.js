// Pure planning for the presentation queue. No DOM here: node tests import
// this file directly. The spec is docs/superpowers/specs/2026-09-19-flip7-game-feel-design.md §3.

export const BUDGET_MS = 2500;       // target lag behind the server
export const BARRIER_CAP_MS = 4000;  // a decision never waits longer than this

// Which events in this snapshot has the client not presented? `cursor` is the
// absolute index of the next unseen event (null for a fresh presenter).
export function newEvents(cursor, game) {
  const history = game.history || [];
  const start = game.history_start || 0;
  const end = start + history.length;
  if (cursor === null || cursor === undefined || start > cursor) return { events: [], reset: true, cursor: end };
  if (cursor >= end) return { events: [], reset: false, cursor: end };
  return { events: history.slice(cursor - start), reset: false, cursor: end };
}

export function cardKind(card) {
  if (typeof card === "number") return "number";
  if (card === "x2" || (typeof card === "string" && card.startsWith("+"))) return "modifier";
  return "action";
}

// Timings from spec §3.2. `min` is the catch-up floor for consequential steps.
export const T = {
  pressDeck: 70, travel: 240, flip: 190, rest: 220, sort: 160, restFlipThree: 300, beatFlipThree: 140, dealStagger: 110,
  actionHold: 450, toDiscard: 220, scoreRoll: 220,
  bustPair: 500, bustShake: 280, bustHold: 550, sweep: 320,
  scPair: 400, scFlash: 300, scDiscard: 300, tokenLand: 260, tokenArc: 360,
  freezeSweep: 320, bankedStamp: 260, notches: 350, flip7Ring: 900, reshuffle: 300, sheet: 900, results: 1500,
};
const MIN = { flip: 120, rest: 150, hold: 250, bustPair: 350, bustHold: 250, scPair: 400, scFlash: 150, sweep: 120, flip7Ring: 400, sheet: 300, results: 700 };
const REDUCED_ZERO = new Set(["press-deck", "travel", "shake", "sweep", "score-roll", "token-arc", "token-land", "sort", "to-discard", "to-token", "park", "reshuffle", "freeze-sweep", "notches"]);
// Events that belong to the reveal just before them (same player, or same `from`):
// they are planned inside the reveal group so a Flip Three or deal postlude follows them.
const CONSEQUENCE = new Set(["bust", "second_chance_saved", "second_chance_kept", "second_chance_given", "second_chance_discarded", "freeze", "flip_three_started", "set_aside"]);
const step = (kind, tier, ms, fields = {}) => ({ kind, tier, ms, min: fields.min ?? 0, ...fields });
const S = (kind, ms, f) => step(kind, "structural", ms, f);
const C = (kind, ms, min, f) => step(kind, "consequential", ms, { ...f, min });
const X = (kind, ms, f) => step(kind, "cosmetic", ms, f);

const owner = (e) => e.player ?? e.from;
const belongs = (e, next) => !!next && CONSEQUENCE.has(next.type) && owner(next) === e.player;

// The reveal steps only; the caller appends the consequence and then the postlude.
function reveal(e, next, source) {
  const kind = cardKind(e.card);
  const at = { player: e.player, card: e.card };
  const out = [];
  if (source !== "dealt") out.push(S("press-deck", T.pressDeck, at));
  out.push(S("travel", T.travel, at), C("flip", T.flip, MIN.flip, at));
  const rest = source === "flip_three_card" ? T.restFlipThree : T.rest;
  if (kind === "number") {
    if (!(belongs(e, next) && (next.type === "bust" || next.type === "second_chance_saved"))) out.push(C("rest", rest, MIN.rest, at), S("sort", T.sort, at));
  } else if (kind === "modifier") {
    out.push(C("rest", rest, MIN.rest, at), S("sort", T.sort, at), X("score-roll", T.scoreRoll, at));
  } else {
    out.push(C("hold", T.actionHold, MIN.hold, at));
    const n = belongs(e, next) ? next.type : null;
    if (n === "set_aside") out.push(S("park", T.toDiscard, at));
    else if (n === "second_chance_kept") out.push(S("to-token", T.toDiscard, at));
    else out.push(S("to-discard", T.toDiscard, at));
  }
  return out;
}

function postlude(source, at) {
  if (source === "flip_three_card") return [S("beat", T.beatFlipThree, at), S("pip-remove", 0, at)];
  if (source === "dealt") return [S("beat", T.dealStagger, at)];
  return [];
}

function consequence(e, prev, nameOf) {
  switch (e.type) {
    case "bust": return [
      C("pair", T.bustPair, MIN.bustPair, { player: e.player, card: e.card, caption: `BUST · duplicate ${e.card}` }),
      S("shake", T.bustShake, { player: e.player }),
      C("hold", T.bustHold, MIN.bustHold, { player: e.player }),
      S("sweep", T.sweep, { player: e.player, card: e.card, min: MIN.sweep })];
    case "second_chance_saved": return [
      C("pair", T.scPair, MIN.scPair, { player: e.player, card: e.card, caption: "SECOND CHANCE" }),
      C("shield-flash", T.scFlash, MIN.scFlash, { player: e.player }),
      S("to-discard", T.scDiscard, { player: e.player, card: e.card, shield: true })];
    case "second_chance_kept": return [S("token-land", T.tokenLand, { player: e.player })];
    case "second_chance_given": return [S("token-arc", T.tokenArc, { from: e.from, to: e.to, caption: `${nameOf(e.from)} gives Second Chance to ${nameOf(e.to)}` })];
    case "second_chance_discarded": return [S("caption", 0, { caption: "Second Chance discarded" })];
    case "freeze": return [S("freeze-sweep", T.freezeSweep, { from: e.from, to: e.to, caption: `${nameOf(e.to)} is frozen` })];
    case "flip_three_started": return [S("pips-set", 0, { from: e.from, to: e.to, player: e.to, caption: `${nameOf(e.to)} must flip three` })];
    case "flip_three_ended": return [S("pips-clear", 0, { player: e.player })];
    case "set_aside": return []; // the reveal before it already parked the card
    case "stay": {
      const forced = prev && prev.type === "deck_exhausted" && prev.player === e.player;
      return [X("banked-stamp", T.bankedStamp, { player: e.player, caption: forced ? "No cards left · banked" : `${nameOf(e.player)} banks` })];
    }
    case "flip7": return [X("notches", T.notches, { player: e.player }), C("flip7-ring", T.flip7Ring, MIN.flip7Ring, { player: e.player, caption: "FLIP 7 +15" })];
    case "round_started": return [S("round-start", 0, { caption: `Round ${e.roundNumber} · ${nameOf(e.dealer)} deals` })];
    case "reshuffle": return [S("reshuffle", T.reshuffle, { caption: `Discard reshuffled (${e.count})` })];
    case "deck_exhausted": return [S("caption", 0, { caption: "No cards left to flip" })];
    case "round_ended": return [C("sheet", T.sheet, MIN.sheet, {})];
    case "game_over": return [C("results", T.results, MIN.results, { player: e.winner })];
    default: return [];
  }
}

export function planSteps(events, game, opts = {}) {
  const nameOf = opts.nameOf || ((id) => id);
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i], next = events[i + 1], prev = events[i - 1];
    if (e.type === "dealt" || e.type === "hit" || e.type === "flip_three_card") {
      out.push(...reveal(e, next, e.type));
      if (belongs(e, next)) { out.push(...consequence(next, e, nameOf)); i += 1; }
      out.push(...postlude(e.type, { player: e.player, card: e.card }));
    } else {
      out.push(...consequence(e, prev, nameOf));
    }
  }
  if (opts.reducedMotion) for (const s of out) { if (REDUCED_ZERO.has(s.kind)) s.ms = 0; else if (s.kind === "flip") s.ms = MIN.flip; }
  out.push(C("barrier", 0, 0, { turnNumber: game.turnNumber }));
  return out;
}

export function totalMs(steps) { return steps.reduce((n, s) => n + s.ms, 0); }

// Catch-up mode (spec §3.3): keep every consequential card readable at its
// floor, drop decoration, collapse movement.
export function compress(steps) {
  const out = [];
  for (const s of steps) {
    if (s.kind === "barrier") { out.push(s); continue; }   // by reference: the presenter's cap timer holds it
    if (s.tier === "cosmetic") continue;
    if (s.tier === "structural") { out.push({ ...s, ms: s.kind === "sweep" ? MIN.sweep : 0 }); continue; }
    out.push({ ...s, ms: Math.min(s.ms, s.min) });
  }
  return out;
}
