// DOM effects for the presentation queue. `render` and `preRender` reconcile;
// step handlers (Tasks 8 and 9) animate between them.
import * as table from "./table.js";
const $ = (id) => document.getElementById(id);

// A scaffold copy of `state` with every hand emptied out: used to reconcile
// seats, names, banked scores, and the deck count before the first deal's
// steps run, so they never travel against a hidden view with no seats.
function emptyHands(state) {
  const g = state.game;
  return {
    ...state,
    game: {
      ...g,
      discard: [],
      resolution: [],
      players: g.players.map((p) => ({ ...p, numbers: [], modifiers: [], second_chance: false, status: "active", round_score: 0 })),
    },
  };
}

export function createEffects({ ctx, showView }) {
  const handlers = { begin: {}, end: {} };
  let captionTimer = null;
  function caption(text, tone = "", ttlMs = 0) {
    const c = $("caption"); c.textContent = text || ""; c.className = `caption ${tone}`.trim();
    clearTimeout(captionTimer); captionTimer = null;
    if (ttlMs > 0) captionTimer = setTimeout(() => { c.textContent = ""; c.className = "caption"; }, ttlMs);
  }
  // Built as a named object so Tasks 8 and 9 can add step handlers and wrap `render` before it is returned.
  const api = {
    handlers, caption,
    scaffold(state) { showView("tableView"); table.hideSheet(); table.render(emptyHands(state), ctx); },
    render(state) {
      if (!state.game) { table.hideSheet(); table.stop(); table.clearPending(); return; }
      const ph = state.game.phase;
      showView("tableView");
      table.render(state, ctx);
      // The sheet/results steps already presented their view at the barrier
      // that opened them; a later barrier's reconcile must not replay their
      // row/fan animations or restart the progress track.
      if (ph === "round_over") { if ($("summarySheet").hidden) table.renderSheet(state, ctx); }
      else if (ph === "game_over") { table.hideSheet(); if ($("resultsView").hidden) { showView("resultsView"); table.renderResults(state, ctx); } }
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
  const baseRender = api.render; api.render = (state) => { flying.clear(); $("fxLayer").textContent = ""; baseRender(state); };
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
  // A Second Chance save discards two objects: the duplicate card and the
  // shield it spent. Clone the shield into #fxLayer as a fixed-position
  // token so it visibly flies to discard too, instead of just vanishing.
  H["to-discard"] = (s) => {
    const el = flying.get(s.player); if (el) { el.style.setProperty("--dur", `${s.ms}ms`); place(el, rect(table.discardEl())); }
    const twin = table.cardEl(s.player, table.keyFor(s.card));
    if (s.shield) {
      const sh = table.seatEl(s.player)?.querySelector(".shield");
      if (sh && !sh.hidden) {
        const r = rect(sh);
        const clone = sh.cloneNode(true);
        clone.hidden = false; clone.classList.add("reveal-token");
        clone.style.position = "fixed"; clone.style.left = `${r.left}px`; clone.style.top = `${r.top}px`;
        clone.style.width = `${r.width}px`; clone.style.height = `${r.height}px`; clone.style.zIndex = 41;
        clone.style.transition = `transform ${s.ms}ms var(--move)`;
        $("fxLayer").appendChild(clone); void clone.offsetWidth;
        const d = rect(table.discardEl());
        clone.style.transform = `translate(${d.left - r.left}px, ${d.top - r.top}px)`;
        s._shieldClone = clone;
      }
      table.setShield(s.player, false);
      if (twin) twin.classList.remove("dup");
    }
  };
  E["to-discard"] = (s) => { const el = flying.get(s.player); if (el) { el.remove(); flying.delete(s.player); } table.setDiscardTop(s.card); if (s._shieldClone) { s._shieldClone.remove(); s._shieldClone = null; } };
  H.park = (s) => { const el = flying.get(s.player); if (el) { el.style.setProperty("--dur", `${s.ms}ms`); place(el, rect(table.parkedEl().parentElement)); } };
  E.park = (s) => { const el = flying.get(s.player); if (el) { el.remove(); flying.delete(s.player); } const c = table.makeCard(s.card, "sm"); c.dataset.player = s.player; table.parkedEl().appendChild(c); };
  H["score-roll"] = (s) => { const el = table.seatEl(s.player)?.querySelector(".round-score"); if (el) { el.classList.remove("roll"); void el.offsetWidth; el.classList.add("roll"); const p = latestPlayer(s.player); if (p) el.textContent = String(p.round_score); } };
  H.pair = (s) => { const el = flying.get(s.player); const twin = table.cardEl(s.player, table.keyFor(s.card)); if (twin) { twin.classList.add("dup"); if (el) { el.classList.add("dup"); const r = rect(twin); place(el, { left: r.right + 6, top: r.top + (r.height - el.offsetHeight) / 2, width: el.offsetWidth, height: el.offsetHeight }); el.style.setProperty("--dur", "160ms"); } } };
  H.shake = (s) => { const li = table.seatEl(s.player); if (li) { li.classList.remove("shake"); void li.offsetWidth; li.classList.add("shake"); } };
  E.shake = (s) => table.seatEl(s.player)?.classList.remove("shake");
  H.sweep = (s) => { const h = table.handEl(s.player); const el = flying.get(s.player); const d = rect(table.discardEl());
    if (h) { const hr = rect(h); h.style.setProperty("--sx", `${d.left - hr.left}px`); h.style.setProperty("--sy", `${d.top - hr.top}px`); h.classList.add("sweeping"); }
    if (el) { el.style.setProperty("--dur", `${s.ms}ms`); place(el, d); }
    for (const c of table.parkedEl().querySelectorAll(`[data-player="${s.player}"]`)) c.remove(); };
  E.sweep = (s) => { const h = table.handEl(s.player); if (h) { h.classList.remove("sweeping"); table.clearHand(s.player); } const el = flying.get(s.player); if (el) { el.remove(); flying.delete(s.player); } table.setStatus(s.player, "busted"); table.setRoundScore(s.player, 0); table.setDiscardTop(s.card ?? null); };
  H["shield-flash"] = (s) => { const sh = table.seatEl(s.player)?.querySelector(".shield"); if (sh) { sh.hidden = false; sh.classList.remove("flash"); void sh.offsetWidth; sh.classList.add("flash"); } };
  // A kept Second Chance never touches the discard: the flying card shrinks into the shield token.
  H["to-token"] = (s) => { const el = flying.get(s.player); const sh = table.seatEl(s.player)?.querySelector(".shield"); if (el) { el.style.setProperty("--dur", `${s.ms}ms`); if (sh) { sh.hidden = false; place(el, rect(sh)); } el.style.transition = `transform ${s.ms}ms var(--move), opacity ${s.ms}ms`; el.style.opacity = "0"; } };
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
  const unpark = (id) => { const c = table.parkedEl().querySelector(`[data-player="${id}"]`); if (c) { table.setDiscardTop(cardOf(c)); c.remove(); } };
  const cardOf = (el) => { const b = el.querySelector("b")?.textContent || ""; return el.classList.contains("number") ? Number(b) : el.getAttribute("aria-label") === "Freeze" ? "freeze" : el.getAttribute("aria-label") === "Flip 3" ? "flip_three" : "second_chance"; };
  let pips = new Map();
  H["pips-set"] = (s) => { unpark(s.from); pips.set(s.player, 3); table.setPips(s.player, 3); };
  H["pip-remove"] = (s) => { const n = Math.max(0, (pips.get(s.player) || 0) - 1); pips.set(s.player, n); table.setPips(s.player, n); };
  H["pips-clear"] = (s) => { pips.delete(s.player); table.setPips(s.player, 0); };
  H["freeze-sweep"] = (s) => { unpark(s.from); const h = table.handEl(s.to); if (h) { h.classList.remove("freeze-sweep"); void h.offsetWidth; h.classList.add("freeze-sweep"); } };
  E["freeze-sweep"] = (s) => { table.handEl(s.to)?.classList.remove("freeze-sweep"); table.setStatus(s.to, "frozen"); };
  const prevLand = H["token-land"];
  H["token-land"] = (s) => { unpark(s.player); prevLand(s); };
  H["banked-stamp"] = (s) => { const st = table.seatEl(s.player)?.querySelector(".stamp"); if (st) { st.hidden = false; } table.setStatus(s.player, "stayed"); };
  H.notches = (s) => { const h = table.handEl(s.player); if (!h) return; h.querySelectorAll(".notches").forEach((n) => { n.style.transition = "--n 350ms linear"; n.style.setProperty("--n", 7); }); };
  H["flip7-ring"] = (s) => { const li = table.seatEl(s.player); if (li) { li.classList.remove("flip7"); void li.offsetWidth; li.classList.add("flip7"); } };
  E["flip7-ring"] = (s) => table.seatEl(s.player)?.classList.remove("flip7");
  H.sheet = () => { const st = table.mount.state; if (st) table.renderSheet(st, ctx); };
  H.results = () => { const st = table.mount.state; if (st && st.game.phase === "game_over") { table.hideSheet(); showView("resultsView"); table.renderResults(st, ctx); } };

  return api;
}
