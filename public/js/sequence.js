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
