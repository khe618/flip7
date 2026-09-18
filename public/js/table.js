import { renderLog } from "./log.js";
const $ = (id) => document.getElementById(id);
const CARD_LABEL = { freeze: "Freeze", flip_three: "Flip 3", second_chance: "2nd Chance" };
let countdown = null;
let lastRound = null;           // the round seenCounts describes
const seenCounts = new Map();   // player id -> number of cards rendered last time

// Called when the room is left: stop the countdown and forget the card counts.
export function stop() { clearInterval(countdown); countdown = null; lastRound = null; seenCounts.clear(); }

function cardEl(card, extra = "") {
  const el = document.createElement("span");
  const kind = typeof card === "number" ? "number" : card === "x2" || card.startsWith("+") ? "modifier" : "action";
  el.className = `card ${kind} ${extra}`.trim();
  el.textContent = typeof card === "number" ? String(card) : card === "x2" ? "×2" : CARD_LABEL[card] || card;
  return el;
}

export function render(state, ctx) {
  const g = state.game;
  if (!g) return;
  // Every line is emptied when a round starts, so the counters have to reset
  // with the round; otherwise no card is marked new until a later round grows
  // longer than the one before it, and the flip stops animating after round 1.
  if (g.round !== lastRound) { lastRound = g.round; seenCounts.clear(); }
  const nameOf = (id) => (g.players.find((p) => p.id === id) || { name: id }).name;
  const current = g.current_player ? nameOf(g.current_player) : "";
  const timer = state.timer;
  $("tableStatus").textContent = g.phase === "round" ? (g.current_player === ctx.you ? "Your decision" : `${current} is deciding`) : g.phase === "round_over" ? "Round over" : "";
  clearInterval(countdown);
  if (timer && g.phase === "round") {
    let remaining = timer.remainingMs;
    const tick = () => { $("tableStatus").dataset.seconds = Math.ceil(Math.max(0, remaining) / 1000); remaining -= 250; };
    tick(); countdown = setInterval(tick, 250);
  } else delete $("tableStatus").dataset.seconds;

  const rows = $("playerRows"); rows.textContent = "";
  for (const p of g.players) {
    const li = document.createElement("li");
    li.className = `player-row status-${p.status}` + (p.id === g.current_player ? " current" : "") + (p.id === ctx.you ? " you" : "");
    li.innerHTML = `<div class="row-head"><span class="name"></span>${p.id === g.dealer ? '<span class="badge">dealer</span>' : ""}<span class="status"></span><span class="score"></span></div><div class="line"></div>`;
    li.querySelector(".name").textContent = p.name + (p.id === ctx.you ? " (you)" : "");
    li.querySelector(".status").textContent = p.status;
    li.querySelector(".score").textContent = `${p.score} banked · ${p.round_score} this round`;
    const line = li.querySelector(".line");
    const all = [...p.numbers.map((n) => cardEl(n)), ...p.modifiers.map((m) => cardEl(m))];
    if (p.second_chance) all.push(cardEl("second_chance", "held"));
    const before = seenCounts.get(p.id) || 0;
    all.forEach((el, i) => { if (i >= before) { el.classList.add("new"); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("new"))); } line.appendChild(el); });
    seenCounts.set(p.id, all.length);
    rows.appendChild(li);
  }
  $("deckInfo").textContent = `Deck: ${g.deck_remaining}`;
  $("discardInfo").textContent = g.discard.length ? `Discard: ${g.discard.length} (last ${typeof g.discard.at(-1) === "number" ? g.discard.at(-1) : CARD_LABEL[g.discard.at(-1)] || g.discard.at(-1)})` : "Discard: empty";

  const mine = g.decision && g.current_player === ctx.you ? g.decision : null;
  $("controls").hidden = !(mine && mine.type === "hit_or_stay");
  $("targetPicker").hidden = !(mine && mine.type === "choose_target");
  if (mine && mine.type === "hit_or_stay") {
    $("hitBtn").onclick = () => ctx.send({ type: "act", turnNumber: g.turnNumber, action: "hit" });
    $("stayBtn").onclick = () => ctx.send({ type: "act", turnNumber: g.turnNumber, action: "stay" });
  }
  if (mine && mine.type === "choose_target") {
    const picker = $("targetPicker"); picker.textContent = "";
    const h = document.createElement("p"); h.textContent = `Give ${CARD_LABEL[mine.card]} to:`; picker.appendChild(h);
    for (const id of mine.candidates) {
      const p = g.players.find((q) => q.id === id);
      const b = document.createElement("button"); b.className = "big";
      b.textContent = `${p.name}${id === ctx.you ? " (you)" : ""} · ${p.score + p.round_score}`;
      b.onclick = () => ctx.send({ type: "act", turnNumber: g.turnNumber, action: "target:" + id });
      picker.appendChild(b);
    }
  }
  renderLog(g, nameOf);
}

export function renderRoundOverlay(state, ctx) {
  const s = state.roundSummary;
  $("roundOverlay").hidden = false;
  $("roundTitle").textContent = `Round ${s.round} over`;
  const t = $("roundTable"); t.textContent = "";
  for (const row of s.rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="name"></td><td class="delta"></td><td class="total"></td>`;
    tr.querySelector(".name").textContent = row.name + (row.flip7 ? " · Flip 7!" : "");
    tr.querySelector(".delta").textContent = `+${row.roundScore}`;
    tr.querySelector(".total").textContent = String(row.score);
    t.appendChild(tr);
  }
  $("nextRoundBtn").onclick = () => ctx.send({ type: "next-round", roundNumber: s.round });
}
