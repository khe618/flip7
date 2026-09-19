// DOM effects for the presentation queue. `render` and `preRender` reconcile;
// step handlers (Tasks 8 and 9) animate between them.
import * as table from "./table.js";
const $ = (id) => document.getElementById(id);

export function createEffects({ ctx, showView }) {
  const handlers = { begin: {}, end: {} };
  function caption(text, tone = "") { const c = $("caption"); c.textContent = text || ""; c.className = `caption ${tone}`.trim(); $("live").textContent = text || ""; }
  // Built as a named object so Tasks 8 and 9 can add step handlers and wrap `render` before it is returned.
  const api = {
    handlers, caption,
    render(state) {
      if (!state.game) return;
      const ph = state.game.phase;
      showView("tableView");
      table.render(state, ctx);
      if (ph === "round_over") table.renderSheet(state, ctx);
      else if (ph === "game_over") { table.hideSheet(); showView("resultsView"); table.renderResults(state, ctx); }
      else table.hideSheet();
    },
    preRender(state) { table.preRender(state, ctx); },
    begin(step) { if (step.caption) caption(step.caption, step.kind === "pair" && /BUST/.test(step.caption) ? "loud" : /FLIP 7|SECOND CHANCE/.test(step.caption || "") ? "gold" : ""); (handlers.begin[step.kind] || (() => {}))(step); },
    end(step) { (handlers.end[step.kind] || (() => {}))(step); },
  };
  // Tasks 8 and 9 insert their handler definitions here, before the return.
  const flying = new Map();
  const rect = (el) => el.getBoundingClientRect();
  const place = (el, r) => { el.style.setProperty("--x", `${r.left + (r.width - el.offsetWidth) / 2}px`); el.style.setProperty("--y", `${r.top + (r.height - el.offsetHeight) / 2}px`); };
  const handTarget = (id) => { const h = table.handEl(id); const cards = h ? h.querySelectorAll(".playing-card") : []; const last = cards[cards.length - 1]; if (last) { const r = rect(last); return { left: r.right + 4, top: r.top, width: r.width, height: r.height }; } return h ? rect(h) : rect(table.deckEl()); };
  function spawn(step) {
    const el = table.makeCard(step.card, "reveal"); el.classList.add("reveal", "back"); el.dataset.face = "back";
    el.style.setProperty("--dur", "0ms"); $("fxLayer").appendChild(el); place(el, rect(table.deckEl()));
    void el.offsetWidth; flying.set(step.player, el); return el;
  }
  const H = handlers.begin, E = handlers.end;
  // table.render empties #fxLayer, so a capped barrier must not leave detached
  // reveal cards in the map: wrap render to clear it.
  const baseRender = api.render; api.render = (state) => { flying.clear(); baseRender(state); };
  H["press-deck"] = () => table.deckEl().classList.add("press");
  E["press-deck"] = () => table.deckEl().classList.remove("press");
  H.travel = (s) => { const el = flying.get(s.player) || spawn(s); el.style.setProperty("--dur", `${s.ms}ms`); place(el, handTarget(s.player)); };
  H.flip = (s) => { const el = flying.get(s.player); if (!el) return; el.classList.add("flipping");
    if (s.ms <= 120) { el.classList.add("emph"); el.classList.remove("back"); el.dataset.face = "front"; el.style.setProperty("--ry", "0deg"); return; }
    el.style.setProperty("--dur", `${Math.max(1, s.ms / 2)}ms`); el.style.setProperty("--ry", "90deg");
    setTimeout(() => { el.classList.remove("back"); el.dataset.face = "front"; el.style.setProperty("--ry", "0deg"); }, Math.max(1, s.ms / 2)); };
  E.flip = (s) => { const el = flying.get(s.player); if (el) { el.classList.remove("flipping", "back", "emph"); el.style.setProperty("--ry", "0deg"); } };
  H.sort = (s) => { const el = flying.get(s.player); const real = table.addCard(s.player, s.card); if (real && el) { real.classList.add("new"); place(el, rect(real)); el.style.setProperty("--dur", `${s.ms}ms`); } };
  E.sort = (s) => { const el = flying.get(s.player); if (el) { el.remove(); flying.delete(s.player); } const real = table.handEl(s.player)?.querySelector(".playing-card.new"); if (real) real.classList.remove("new"); };
  H["to-discard"] = (s) => { const el = flying.get(s.player); if (el) { el.style.setProperty("--dur", `${s.ms}ms`); place(el, rect(table.discardEl())); } const twin = table.cardEl(s.player, table.keyFor(s.card)); if (s.shield) { table.setShield(s.player, false); if (twin) twin.classList.remove("dup"); } };
  E["to-discard"] = (s) => { const el = flying.get(s.player); if (el) { el.remove(); flying.delete(s.player); } table.setDiscardTop(s.card); };
  H.park = (s) => { const el = flying.get(s.player); if (el) { el.style.setProperty("--dur", `${s.ms}ms`); place(el, rect(table.parkedEl().parentElement)); } };
  E.park = (s) => { const el = flying.get(s.player); if (el) { el.remove(); flying.delete(s.player); } const c = table.makeCard(s.card, "sm"); c.dataset.player = s.player; table.parkedEl().appendChild(c); };
  H["score-roll"] = (s) => { const el = table.seatEl(s.player)?.querySelector(".round-score"); if (el) { el.classList.remove("roll"); void el.offsetWidth; el.classList.add("roll"); const p = latestPlayer(s.player); if (p) el.textContent = String(p.round_score); } };
  H.pair = (s) => { const el = flying.get(s.player); const twin = table.cardEl(s.player, table.keyFor(s.card)); if (twin) { twin.classList.add("dup"); if (el) { el.classList.add("dup"); const r = rect(twin); place(el, { left: r.right + 6, top: r.top, width: r.width, height: r.height }); el.style.setProperty("--dur", "160ms"); } } };
  H.shake = (s) => { const li = table.seatEl(s.player); if (li) { li.classList.remove("shake"); void li.offsetWidth; li.classList.add("shake"); } };
  E.shake = (s) => table.seatEl(s.player)?.classList.remove("shake");
  H.sweep = (s) => { const h = table.handEl(s.player); const el = flying.get(s.player); const d = rect(table.discardEl());
    if (h) { const hr = rect(h); h.style.setProperty("--sx", `${d.left - hr.left}px`); h.style.setProperty("--sy", `${d.top - hr.top}px`); h.classList.add("sweeping"); }
    if (el) { el.style.setProperty("--dur", `${s.ms}ms`); place(el, d); }
    for (const c of table.parkedEl().querySelectorAll(`[data-player="${s.player}"]`)) c.remove(); };
  E.sweep = (s) => { const h = table.handEl(s.player); if (h) { h.classList.remove("sweeping"); table.clearHand(s.player); } const el = flying.get(s.player); if (el) { el.remove(); flying.delete(s.player); } table.setStatus(s.player, "busted"); table.setRoundScore(s.player, 0); table.setDiscardTop(s.card ?? null); };
  H["shield-flash"] = (s) => { const sh = table.seatEl(s.player)?.querySelector(".shield"); if (sh) { sh.hidden = false; sh.classList.remove("flash"); void sh.offsetWidth; sh.classList.add("flash"); } };
  // A kept Second Chance never touches the discard: the flying card shrinks into the shield token.
  H["to-token"] = (s) => { const el = flying.get(s.player); const sh = table.seatEl(s.player)?.querySelector(".shield"); if (el) { el.style.setProperty("--dur", `${s.ms}ms`); if (sh) { sh.hidden = false; place(el, rect(sh)); } el.style.opacity = "0"; el.style.transition += ", opacity " + s.ms + "ms"; } };
  E["to-token"] = (s) => { const el = flying.get(s.player); if (el) { el.remove(); flying.delete(s.player); } };
  H["token-land"] = (s) => { table.setShield(s.player, true); const sh = table.seatEl(s.player)?.querySelector(".shield"); if (sh) { sh.classList.remove("flash"); void sh.offsetWidth; sh.classList.add("flash"); } };
  E["token-land"] = (s) => table.seatEl(s.player)?.querySelector(".shield")?.classList.remove("flash");
  // The given card is the giver's *second* Second Chance: it arcs from the discard, and the giver keeps their own shield.
  H["token-arc"] = (s) => { const to = table.seatEl(s.to); if (!to) return; const tok = document.createElement("span"); tok.className = "shield reveal-token"; tok.style.position = "fixed"; tok.style.zIndex = 41; tok.style.transition = `transform ${s.ms}ms var(--move)`; const a = rect(table.discardEl()); const b = rect(to.querySelector(".hand")); tok.style.left = `${a.left}px`; tok.style.top = `${a.top}px`; $("fxLayer").appendChild(tok); void tok.offsetWidth; tok.style.transform = `translate(${b.right - 26 - a.left}px, ${b.top - a.top}px)`; };
  E["token-arc"] = (s) => { for (const t of $("fxLayer").querySelectorAll(".reveal-token")) t.remove(); table.setShield(s.to, true); };
  H.caption = () => {};
  H["round-start"] = () => { table.hideSheet(); for (const el of flying.values()) el.remove(); flying.clear(); $("parked").textContent = ""; };
  H.reshuffle = () => { const top = $("discardTop"); top.style.transition = "transform 300ms var(--move), opacity 300ms"; const d = rect(table.discardEl()), k = rect(table.deckEl()); top.style.transform = `translate(${k.left - d.left}px, ${k.top - d.top}px)`; top.style.opacity = "0"; };
  E.reshuffle = () => { const top = $("discardTop"); top.style.transition = ""; top.style.transform = ""; top.style.opacity = ""; table.setDiscardTop(null); };
  function latestPlayer(id) { const st = table.mount.state; return st && st.game ? st.game.players.find((p) => p.id === id) : null; }

  return api;
}
