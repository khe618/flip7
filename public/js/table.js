import { renderLog } from "./log.js";
import { cardKind } from "./sequence.js";
const $ = (id) => document.getElementById(id);
const LABEL = { freeze: "Freeze", flip_three: "Flip 3", second_chance: "2nd Chance" };
const ARIA = (card) => typeof card === "number" ? `number ${card}` : card === "x2" ? "times 2" : card.startsWith("+") ? `plus ${card.slice(1)}` : (LABEL[card] || card);
const GLYPH = {
  freeze: '<svg viewBox="0 0 24 24"><path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19"/></svg>',
  flip_three: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="8" height="11" rx="1"/><rect x="8" y="7" width="8" height="11" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/></svg>',
  second_chance: '<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/></svg>',
};
let countdown = null, pending = null, mounted = false;

export function keyFor(card, ordinal = 0) { return typeof card === "number" ? `n:${card}` : `m:${card}:${ordinal}`; }
export function makeCard(card, size = "") {
  const el = document.createElement("span");
  const kind = cardKind(card);
  el.className = `playing-card ${kind} ${size}`.trim();
  el.setAttribute("aria-label", ARIA(card));
  if (kind === "number") el.innerHTML = `<b>${card}</b><i class="idx">${card}</i><i class="notches"></i>`;
  else if (kind === "modifier") el.innerHTML = `<b>${card === "x2" ? "×2" : card}</b>`;
  else el.innerHTML = `${GLYPH[card] || ""}<b>${LABEL[card] || card}</b>`;
  return el;
}

export function stop() { clearInterval(countdown); countdown = null; $("seats").textContent = ""; $("yourRail").textContent = ""; clearPending(); }
// Called on a newer turn, on reconnect, and on any server error: a lost action
// must never leave the controls or the target picker dead.
export function clearPending() {
  pending = null;
  for (const b of [$("hitBtn"), $("stayBtn")]) { b.disabled = false; b.style.width = ""; b.querySelector(".spinner").hidden = true; }
  $("hitBtn").querySelector(".label").textContent = "Hit"; $("stayBtn").querySelector(".label").textContent = "Stay";
  for (const b of $("targetPicker").querySelectorAll("button")) { b.disabled = false; b.classList.remove("pending"); }
}

export function mount(ctx) {
  if (mounted) return; mounted = true;
  const press = (action, label) => {
    const g = mount.state && mount.state.game; if (!g || pending) return;
    pending = { turnNumber: g.turnNumber };
    ctx.send({ type: "act", turnNumber: g.turnNumber, action });
    const btn = action === "hit" ? $("hitBtn") : $("stayBtn");
    for (const b of [$("hitBtn"), $("stayBtn")]) { b.style.width = `${b.getBoundingClientRect().width}px`; b.disabled = true; }
    btn.querySelector(".label").textContent = label; btn.querySelector(".spinner").hidden = false;
  };
  $("hitBtn").onclick = () => press("hit", "Flipping…");
  $("stayBtn").onclick = () => press("stay", "Staying…");
}

// ---- element lookups used by effects.js ----
export const seatEl = (id) => document.querySelector(`.seat[data-player="${id}"]`);
export const handEl = (id) => seatEl(id)?.querySelector(".hand");
export const cardEl = (id, key) => handEl(id)?.querySelector(`.playing-card[data-key="${key}"]`);
export const deckEl = () => $("deck");
export const discardEl = () => $("discard");
export const parkedEl = () => $("parked");
export function setDiscardTop(card) { const top = $("discardTop"); top.textContent = ""; if (card !== null && card !== undefined) top.appendChild(makeCard(card, "sm")); }
export function setStatus(id, status) { const el = seatEl(id); if (!el) return; el.className = el.className.replace(/status-\w+/, `status-${status}`); el.querySelector(".hand").classList.toggle("frozen", status === "frozen"); }
export function setRoundScore(id, n) { const el = seatEl(id)?.querySelector(".round-score"); if (el) el.textContent = String(n); }
export function setShield(id, on) { const el = seatEl(id)?.querySelector(".shield"); if (el) el.hidden = !on; }
export function setPips(id, n) { const el = seatEl(id)?.querySelector(".pips"); if (!el) return; el.hidden = n <= 0; el.querySelectorAll("i").forEach((i, k) => { i.hidden = k >= n; }); }
export function clearHand(id) { const h = handEl(id); if (!h) return; for (const c of h.querySelectorAll(".playing-card")) c.remove(); }
export function addCard(id, card) {
  const h = handEl(id); if (!h) return null;
  const size = seatEl(id).closest(".your-rail") ? "" : "sm";
  const kind = cardKind(card);
  if (kind === "action") return null;
  const existing = [...h.querySelectorAll(".playing-card")];
  const ordinal = kind === "modifier" ? existing.filter((c) => c.dataset.key.startsWith(`m:${card}:`)).length : 0;
  const key = keyFor(card, ordinal);
  if (h.querySelector(`[data-key="${key}"]`)) return h.querySelector(`[data-key="${key}"]`);
  const el = makeCard(card, size); el.dataset.key = key;
  let before = null;
  if (kind === "number") before = existing.find((c) => c.dataset.key.startsWith("n:") && Number(c.dataset.key.slice(2)) > card) || existing.find((c) => c.dataset.key.startsWith("m:")) || h.querySelector(".shield");
  else before = h.querySelector(".shield");
  h.insertBefore(el, before);
  refreshNotches(id);
  return el;
}
function refreshNotches(id) { const h = handEl(id); if (!h) return; const n = h.querySelectorAll(".playing-card.number").length; for (const c of h.querySelectorAll(".playing-card.number .notches")) c.style.setProperty("--n", n); }

// ---- reconcile ----
function reconcileHand(h, p, size) {
  const want = [...p.numbers.map((n) => ({ card: n, key: keyFor(n) })), ...p.modifiers.map((m, i, arr) => ({ card: m, key: keyFor(m, arr.slice(0, i).filter((x) => x === m).length) }))];
  const have = new Map([...h.querySelectorAll(".playing-card")].map((c) => [c.dataset.key, c]));
  for (const [k, c] of have) if (!want.some((w) => w.key === k)) c.remove();
  let anchor = h.querySelector(".shield");
  for (let i = want.length - 1; i >= 0; i--) {
    let el = have.get(want[i].key);
    if (!el) { el = makeCard(want[i].card, size); el.dataset.key = want[i].key; }
    if (el.nextSibling !== anchor) h.insertBefore(el, anchor);
    anchor = el;
  }
  h.querySelector(".shield").hidden = !p.second_chance;
  const n = p.numbers.length; for (const c of h.querySelectorAll(".notches")) c.style.setProperty("--n", n);
}
function ensureSeat(container, p) {
  let li = container.querySelector(`.seat[data-player="${p.id}"]`);
  if (!li) {
    li = document.createElement("li"); li.dataset.player = p.id;
    li.innerHTML = `<div class="seat-head"><span class="name"></span><span class="dealer" title="dealer" hidden>D</span><span class="status-glyph"></span><span class="banked"></span></div><div class="hand"><span class="shield" hidden aria-label="holds a Second Chance"></span><span class="pips" hidden><i></i><i></i><i></i></span></div><div class="seat-foot"><span class="round-score"></span><span class="stamp" hidden>BANKED</span></div>`;
    container.appendChild(li);
  }
  return li;
}
export function render(state, ctx) { mount.state = state; paint(state, ctx, true); }
export function preRender(state, ctx) { mount.state = state; paint(state, ctx, false); }

function paint(state, ctx, settled) {
  const g = state.game; if (!g) return;
  const nameOf = (id) => (g.players.find((p) => p.id === id) || { name: id }).name;
  // turn strip + countdown
  const strip = document.querySelector(".turn-strip");
  strip.classList.toggle("mine", g.current_player === state.you && g.phase === "round");
  $("turnWho").textContent = g.phase === "round" ? (g.current_player === state.you ? "Your decision" : `${nameOf(g.current_player)} is deciding`) : g.phase === "round_over" ? "Round over" : "";
  clearInterval(countdown); const cd = $("countdown");
  if (state.timer && g.phase === "round") {
    cd.hidden = false; let remaining = state.timer.remainingMs; const total = state.timer.totalMs || 30000;
    const tick = () => { const s = Math.ceil(Math.max(0, remaining) / 1000); $("countNum").textContent = s; cd.style.setProperty("--p", Math.max(0, remaining) / total); cd.classList.toggle("warn", s <= 6 && s > 4); cd.classList.toggle("hot", s <= 4 && s > 2); cd.classList.toggle("crit", s <= 2); remaining -= 250; };
    tick(); countdown = setInterval(tick, 250);
  } else cd.hidden = true;
  // seats (only on settled renders: a pre-render must not jump the hands ahead of the animation)
  if (settled) {
    const seats = $("seats"), rail = $("yourRail");
    for (const p of g.players) {
      const mine = p.id === state.you;
      const li = ensureSeat(mine ? rail : seats, p);
      li.className = `seat status-${p.status}` + (p.id === g.current_player ? " current" : "") + (mine ? " you" : "");
      li.querySelector(".name").textContent = p.name;
      li.querySelector(".dealer").hidden = p.id !== g.dealer;
      li.querySelector(".banked").textContent = String(p.score);
      li.querySelector(".round-score").textContent = String(p.round_score);
      li.querySelector(".hand").classList.toggle("frozen", p.status === "frozen");
      reconcileHand(li.querySelector(".hand"), p, mine ? "" : "sm");
      setPips(p.id, 0);
    }
    for (const li of seats.querySelectorAll(".seat")) if (!g.players.some((p) => p.id === li.dataset.player)) li.remove();
    for (const li of rail.querySelectorAll(".seat")) if (!g.players.some((p) => p.id === li.dataset.player)) li.remove();
    $("deckCount").textContent = String(g.deck_remaining);
    setDiscardTop(g.discard.length ? g.discard.at(-1) : null);
    // Open Flip Three frames are authoritative state: their set-aside cards stay parked
    // and their pips stay lit across snapshots (a target decision can interrupt a frame).
    $("parked").textContent = "";
    for (const f of g.resolution) {
      if (f.card === "flip_three" && f.target && !f.ended && f.remaining > 0) setPips(f.target, f.remaining);
      for (const c of f.setAside) { const el = makeCard(c, "sm"); el.dataset.player = f.target; $("parked").appendChild(el); }
    }
    $("fxLayer").textContent = "";
  }
  // controls
  const mine = g.decision && g.current_player === state.you ? g.decision : null;
  if (pending && g.turnNumber > pending.turnNumber) clearPending();
  const hs = mine && mine.type === "hit_or_stay";
  $("controls").hidden = !hs; $("targetPicker").hidden = !(mine && mine.type === "choose_target");
  if (hs) {
    const wait = !settled && !pending;
    for (const b of [$("hitBtn"), $("stayBtn")]) b.disabled = wait || !!pending;
    if (!pending) { $("hitBtn").querySelector(".label").textContent = wait ? "Finishing reveal…" : "Hit"; $("stayBtn").querySelector(".label").textContent = "Stay"; if (!wait) { $("hitBtn").style.width = ""; $("stayBtn").style.width = ""; } }
    if (settled && !pending && document.activeElement !== $("stayBtn")) { $("hitBtn").focus({ preventScroll: true }); $("hitBtn").classList.remove("pulse"); void $("hitBtn").offsetWidth; $("hitBtn").classList.add("pulse"); }
  }
  if (mine && mine.type === "choose_target") {
    const picker = $("targetPicker"); picker.textContent = "";
    const h = document.createElement("p"); h.textContent = `Give ${LABEL[mine.card]} to:`; picker.appendChild(h);
    mine.candidates.forEach((id, i) => {
      const p = g.players.find((q) => q.id === id);
      const b = document.createElement("button"); b.className = "big"; b.disabled = !settled || !!pending;
      b.innerHTML = `<span class="label"></span><span class="spinner" hidden></span>`;
      b.querySelector(".label").textContent = `${p.name}${id === state.you ? " (you)" : ""} · ${p.score + p.round_score}`;
      b.onclick = () => { if (pending) return; pending = { turnNumber: g.turnNumber }; for (const x of picker.querySelectorAll("button")) x.disabled = true; b.classList.add("pending"); b.querySelector(".spinner").hidden = false; ctx.send({ type: "act", turnNumber: g.turnNumber, action: "target:" + id }); };
      picker.appendChild(b); if (i === 0 && settled) b.focus({ preventScroll: true });
    });
  }
  if (settled) renderLog(g, nameOf);
}

// ---- summary sheet and results ----
let sheetTimer = null;
export function renderSheet(state, ctx) {
  const s = state.roundSummary; if (!s) return;
  $("summarySheet").hidden = false;
  $("roundTitle").textContent = state.game.phase === "game_over" ? `Final round ${s.round}` : `Round ${s.round} over`;
  const tb = $("roundTable").querySelector("tbody"); tb.textContent = "";
  s.rows.forEach((row, i) => {
    const tr = document.createElement("tr"); tr.style.setProperty("--i", i);
    const busted = row.status === "busted";
    tr.innerHTML = `<td class="name"></td><td class="delta${busted ? " dash" : ""}"></td><td class="total"></td>`;
    tr.querySelector(".name").textContent = row.name + (row.flip7 ? " · Flip 7!" : "");
    tr.querySelector(".delta").textContent = busted ? "—" : `+${row.roundScore}`;
    tr.querySelector(".total").textContent = String(row.score);
    tb.appendChild(tr);
  });
  const next = $("nextRoundBtn"); next.hidden = state.game.phase === "game_over";
  next.onclick = () => ctx.send({ type: "next-round", roundNumber: s.round });
  clearInterval(sheetTimer);
  if (state.summaryTimer) { let left = state.summaryTimer.remainingMs; const total = state.summaryTimer.totalMs || 8000; const tick = () => { $("nextTrack").style.setProperty("--p", 1 - Math.max(0, left) / total); left -= 250; }; tick(); sheetTimer = setInterval(tick, 250); }
}
export function hideSheet() { $("summarySheet").hidden = true; clearInterval(sheetTimer); }
export function renderResults(state, ctx) {
  const r = state.results; if (!r) return;
  $("winnerLine").textContent = `${r.winnerName} wins`;
  const win = r.standings.find((s) => s.id === r.winner); $("winnerScore").textContent = win ? String(win.score) : "";
  const fan = $("winnerFan"); fan.textContent = "";
  [3, 5, 7, 9, 11, 12, 0].forEach((n, i) => { const c = makeCard(n, "sm"); c.style.setProperty("--i", i); fan.appendChild(c); });
  const last = new Map((state.roundSummary?.rows || []).map((row) => [row.id, row.roundScore]));
  const ol = $("standings"); ol.textContent = "";
  r.standings.forEach((s, i) => { const li = document.createElement("li"); li.innerHTML = `<span class="place"></span><span class="name"></span><span class="last"></span><span class="score"></span>`; li.querySelector(".place").textContent = String(i + 1); li.querySelector(".name").textContent = s.name; li.querySelector(".last").textContent = last.has(s.id) ? `last round +${last.get(s.id)}` : ""; li.querySelector(".score").textContent = String(s.score); ol.appendChild(li); });
  $("playAgainBtn").onclick = () => ctx.send({ type: "return-to-lobby" });
  $("resultsCopyLinkBtn").onclick = ctx.copyLink;
}
