const $ = (id) => document.getElementById(id);
const LABEL = { freeze: "Freeze", flip_three: "Flip 3", second_chance: "Second Chance" };
export function describe(e, nameOf) {
  const n = (id) => nameOf(id);
  switch (e.type) {
    case "round_started": return `Round ${e.roundNumber} — ${n(e.dealer)} deals`;
    case "dealt": return `${n(e.player)} is dealt ${label(e.card)}`;
    case "hit": return `${n(e.player)} hits: ${label(e.card)}`;
    case "stay": return `${n(e.player)} stays`;
    case "bust": return `${n(e.player)} busts on ${label(e.card)}`;
    case "second_chance_saved": return `${n(e.player)} uses Second Chance on ${label(e.card)}`;
    case "second_chance_kept": return `${n(e.player)} keeps a Second Chance`;
    case "second_chance_given": return `${n(e.from)} gives Second Chance to ${n(e.to)}`;
    case "second_chance_discarded": return `Second Chance discarded`;
    case "freeze": return `${n(e.from)} freezes ${n(e.to)}`;
    case "flip_three_started": return `${n(e.from)} gives Flip 3 to ${n(e.to)}`;
    case "flip_three_card": return `${n(e.player)} flips ${label(e.card)}`;
    case "flip_three_ended": return `${n(e.player)}'s Flip 3 ends`;
    case "set_aside": return `${label(e.card)} set aside`;
    case "flip7": return `${n(e.player)} FLIPS 7!`;
    case "reshuffle": return `Discard reshuffled (${e.count} cards)`;
    case "deck_exhausted": return `No cards left to flip`;
    case "round_ended": return `Round over`;
    case "game_over": return `${n(e.winner)} wins`;
    default: return e.type;
  }
}
function label(card) { return typeof card === "number" ? String(card) : card === "x2" ? "×2" : LABEL[card] || card; }
export function renderLog(g, nameOf) {
  const list = $("logList"); list.textContent = "";
  for (const e of g.history.slice().reverse()) { const li = document.createElement("li"); li.textContent = describe(e, nameOf); list.appendChild(li); }
}
