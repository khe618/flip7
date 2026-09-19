import { createNet, readName, writeName, readToken, clearToken } from "./net.js";
import * as landing from "./landing.js";
import * as lobby from "./lobby.js";
import * as table from "./table.js";
import { createPresenter } from "./present.js";
import { createEffects } from "./effects.js";

const $ = (id) => document.getElementById(id);
let net = null, state = null, you = null, room = null, presenter = null;

export function showView(id) { for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== id; }
export function toast(text) {
  const t = $("toast"); t.textContent = text; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
}
function live(text) { $("live").textContent = text; }
// Shared by the join card and the lobby (spec §3.2 promises the button on both).
async function copyLink() {
  try { await navigator.clipboard.writeText(location.href); toast("Link copied"); }
  catch { toast(location.href); }
}

// Leaving a room must drop its socket: a state message arriving after the
// route changed would drag the view back off the landing or rules page.
function leaveRoom() {
  if (net) { net.close(); net = null; }
  table.stop();
  if (presenter) { presenter.reset(); presenter = null; }
  table.hideSheet();
  state = null; you = null; room = null;
  $("roomCode").hidden = true;
}

function route() {
  const m = location.pathname.match(/^\/([a-z]{4})$/);
  if (location.pathname === "/how-to-play") { leaveRoom(); showView("howToPlayView"); return; }
  if (m) { enterRoom(m[1]); return; }
  leaveRoom();
  showView("landingView");
  landing.render({ toast, onNewRoom: (quick) => newRoom(quick) });
}

async function newRoom(quick) {
  const res = await fetch("/api/new-room", { cache: "no-store" });
  const data = await res.json();
  if (!data.ok) { toast("No room available, try again."); return; }
  history.pushState({ room: data.room }, "", "/" + data.room);
  enterRoom(data.room, quick ? "quick" : "join");
}

function enterRoom(code, intent = null) {
  room = code; you = null; state = null;
  $("roomCode").textContent = code; $("roomCode").hidden = false;
  for (const el of document.querySelectorAll("[data-room]")) el.textContent = code;
  if (net) net.close();
  if (presenter) { presenter.reset(); presenter = null; }
  const ctx = { send: (o) => net && net.send(o), toast, room: code, copyLink };
  table.mount(ctx);
  presenter = createPresenter({ effects: createEffects({ ctx, showView }), reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches });
  net = createNet({
    room: code,
    onConnection: (ok) => { $("connPill").hidden = ok; live(ok ? "connected" : "reconnecting"); if (ok) table.clearPending(); },
    onJoined: (msg) => { you = msg.playerId; },
    onError: (msg) => {
      // The socket that lost the seat never reconnects, so the join card it
      // shows needs a live one behind it: drop the token this tab no longer
      // owns (keeping it would steal the seat straight back) and re-enter the
      // room, which binds Sit down to the new socket.
      table.clearPending();
      if (msg.code === "seat_taken_over") { clearToken(code); enterRoom(code); toast(msg.message); return; }
      if (msg.code === "unknown_token" || msg.code === "game_in_progress") { showJoin(); if (msg.code === "game_in_progress") toast("Game in progress, wait for the lobby."); return; }
      toast(msg.message);
    },
    onState: (msg) => { state = msg; render(); },
  });
  if (intent === "quick") { net.send({ type: "quick-play", name: readName() || "You" }); intent = null; }
  else if (!readToken(code)) showJoin();
}

function showJoin() {
  showView("joinView");
  $("joinName").value = readName();
  $("joinBtn").onclick = () => { const name = $("joinName").value.trim() || "Player"; writeName(name); net.send({ type: "join", name }); };
  $("joinCopyLinkBtn").onclick = copyLink;
}

function render() {
  if (!state) return;
  if (state.you === null) { if ($("joinView").hidden) showJoin(); return; }
  you = state.you;
  const ctx = { send: (o) => net.send(o), you, toast, room, copyLink };
  if (state.phase === "lobby" || !state.game) { presenter.enqueue(state); showView("lobbyView"); lobby.render(state, ctx); return; }
  presenter.enqueue(state);
  // The turn strip already announces "Your decision" via the sole live region (#caption);
  // no separate announcement is needed here.
}

window.addEventListener("popstate", route);
route();
