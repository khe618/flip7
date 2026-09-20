"use strict";
const WebSocket = require("ws");
const { resolveAgent } = require("../agents/adapter");
const { decide } = require("../agents/decide");
const { PROTOCOL } = require("../lib/request");
const { parseArgs, UsageError, USAGE } = require("../agents/cli");

// Drives one adapter as a seat in a live room over the browser's own protocol.
//
// Lifecycle: hello once; the seat is requested through exactly one path (requestSeat); start
// exactly once per game, on the first `playing` state seen while seated since the last
// lobby/game_over; end exactly once on game_over; shutdown on close(). An act is sent at most
// once per turnNumber per game, and only if the socket actually took it. A driver that is not
// seated (a visitor: game in progress, or its resume token was rejected) watches without acting
// and joins at the next lobby.
//
// Reconnect: the server sends a visitor snapshot (you: null) the moment a socket connects,
// before it processes our `resume`. While a resume is in flight that snapshot is not a lost
// seat and no join is sent; otherwise the two requests would race and the server would create
// a second seat.
//
// `done` resolves with the game_over state of the driver's own game, and rejects with a
// DriverError whose `code` is seat_taken_over, room_full, or adapter (a fatal AdapterError from
// hello, start, or a decision). Per-move timeouts and invalid replies are fallbacks inside
// decide() and never end the run.

class DriverError extends Error { constructor(code, message) { super(message); this.name = "DriverError"; this.code = code; } }
const EXIT_CODES = { adapter: 2, seat_taken_over: 3, room_full: 4 };
function exitCodeFor(err) { return (err && EXIT_CODES[err.code]) || 2; }

function defaultLogger(log) {
  return (e) => {
    if (e.type === "ready") log(`agent ${e.name}@${e.version} ready`);
    else if (e.type === "seated") log(`seated as ${e.playerId} in room ${e.room}`);
    else if (e.type === "waiting") log(`waiting for the lobby (${e.reason})`);
    else if (e.type === "decision") log(`turn ${e.turnNumber}: ${e.action}${e.fallback ? ` (fallback: ${e.fallback})` : ""}`);
    else if (e.type === "game_over") log(`game over: ${e.standings.map((s) => `${s.name} ${s.score}`).join(", ")}`);
    else if (e.type === "reconnecting") log(`reconnecting in ${e.delayMs} ms`);
    else if (e.type === "error") log(`server error: ${e.code} ${e.message}`);
  };
}

function driveLiveSeat({ url, room, spec, name, log = console.log, onEvent = null, _send = null }) {
  const adapter = resolveAgent(spec);
  const emit = onEvent || defaultLogger(log);
  const stats = { decisions: 0, acts: 0, repeatedStates: 0, fallbacks: 0, serverErrors: 0, lateSkips: 0 };
  let ws = null, you = null, token = null, seated = false, closed = false, delay = 1000, reconnectTimer = null;
  let busy = false, latest = null, gameSerial = 0, inGame = false;
  let joinInFlight = false, resumeInFlight = false, waitingForLobby = false, settled = false;
  const acted = new Set();
  let resolveDone, rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  function finish(err, value) { if (settled) return; settled = true; if (err) rejectDone(err); else resolveDone(value); }
  function fatal(err) { return err instanceof DriverError ? err : new DriverError("adapter", err.message); }
  const helloDone = adapter.hello().then((h) => { emit({ type: "ready", name: h.name, version: h.version }); return h; });
  helloDone.catch((err) => finish(fatal(err)));

  // Returns true only when the message actually went out.
  function send(obj) {
    if (closed) return false;
    if (_send) return _send(obj) !== false;
    if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(obj)); return true; }
    return false;
  }

  // The only place a join is sent. Latches joinInFlight only once the join actually went out; a
  // failed send (socket gone) leaves waitingForLobby set so the next lobby state retries instead
  // of leaving the driver stuck watching forever with a latch nothing will ever clear.
  function requestSeat() {
    if (seated || joinInFlight || resumeInFlight || settled || closed) return;
    if (!send({ type: "join", name: name || adapter.name, agent: true })) { waitingForLobby = true; return; }
    joinInFlight = true; waitingForLobby = false;
  }

  // Same care as requestSeat(): resumeInFlight is set only once the resume actually went out, so
  // a failed send never leaves the resume-race guard latched with nothing to clear it.
  function sendResume() {
    if (!send({ type: "resume", resumeToken: token })) return;
    resumeInFlight = true;
  }

  function loseSeat() { seated = false; you = null; token = null; }

  async function handle(msg) {
    if (msg.phase === "lobby") { inGame = false; if (waitingForLobby) requestSeat(); return; }
    if (!seated) return;                    // a visitor watches; it never starts, acts, or finishes a game
    const g = msg.game;
    if (!g) return;
    if (msg.phase === "playing" && !inGame) {
      // First playing state seen while seated since the last lobby/game_over: a fresh game, or
      // joining/reconnecting mid-game. Either way this is the start of watching one game.
      gameSerial += 1;
      acted.clear();
      inGame = true;
      await adapter.start({ type: "start", protocol: PROTOCOL, game_id: `${room}#${gameSerial}`, you, players: g.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })) });
    }
    if (msg.phase === "game_over") {
      if (inGame) {
        const finalScores = Object.fromEntries(g.players.map((p) => [p.id, p.score]));
        await adapter.end({ type: "end", game_id: `${room}#${gameSerial}`, result: { final_scores: finalScores, winner: g.winner, rounds: g.round } });
        inGame = false;
      }
      emit({ type: "game_over", standings: msg.results ? msg.results.standings : [] });
      finish(null, msg);
      return;
    }
    if (!g.decision || g.current_player !== you) return;
    if (acted.has(g.turnNumber)) { stats.repeatedStates += 1; return; }
    const remaining = msg.timer ? msg.timer.remainingMs : 30000;
    const timeoutMs = Math.max(1, remaining - 250);
    const d = await decide(adapter, { gameView: g, gameId: `${room}#${gameSerial}`, timeoutMs, retry: false });
    stats.decisions += 1;
    if (d.fallback_used) stats.fallbacks += 1;
    if (closed) return;
    if (acted.has(g.turnNumber)) { stats.repeatedStates += 1; return; }
    // A newer state for another turn arrived while deciding: the server already moved on
    // (it defaulted this turn, or the decision was resolved elsewhere). Never answer late.
    if (latest && latest.game && latest.game.turnNumber !== g.turnNumber) { stats.lateSkips += 1; return; }
    if (!send({ type: "act", turnNumber: g.turnNumber, action: d.action })) return;   // socket gone: the turn stays pending for after the reconnect
    acted.add(g.turnNumber);
    stats.acts += 1;
    const first = d.attempts[0];
    emit({ type: "decision", turnNumber: g.turnNumber, action: d.action, latencyMs: d.latency_ms, fallback: d.fallback_used ? (first && first.outcome === "timeout" ? "timeout" : "invalid") : null });
  }

  // States that arrive while a decision is in flight are not dropped: the newest one is
  // reprocessed once the current decision settles. Any exception out of handle() is fatal:
  // decide() has already turned per-move trouble into a fallback, so what reaches here is a
  // broken adapter.
  async function onState(msg) {
    if (closed) return;
    if (msg.you) you = msg.you;
    else if (msg.you === null && seated && !resumeInFlight) { loseSeat(); waitingForLobby = true; }
    latest = msg;
    if (busy) return;
    busy = true;
    try {
      while (latest && !closed) { const m = latest; latest = null; await handle(m); }
    } catch (err) { finish(fatal(err)); }
    finally { busy = false; }
  }

  function onMessage(msg) {
    if (msg.type === "joined") {
      seated = true; joinInFlight = false; resumeInFlight = false; waitingForLobby = false; you = msg.playerId; token = msg.resumeToken;
      emit({ type: "seated", playerId: you, room });
      return undefined;
    }
    if (msg.type === "state") return onState(msg);
    if (msg.type === "error") {
      const code = msg.code || "";
      if (code === "game_in_progress") { joinInFlight = false; waitingForLobby = true; emit({ type: "waiting", reason: "game in progress" }); return undefined; }
      if (code === "room_full") { joinInFlight = false; finish(new DriverError("room_full", "Room is full.")); return undefined; }
      if (code === "unknown_token") { resumeInFlight = false; joinInFlight = false; loseSeat(); requestSeat(); return undefined; }
      if (code === "stale_turn" || code === "illegal_action" || code === "not_your_turn") stats.serverErrors += 1;
      emit({ type: "error", code, message: msg.message });
    }
    return undefined;
  }

  function connect() {
    ws = new WebSocket(`${url.replace(/\/+$/, "")}/ws?room=${room}`);
    ws.on("open", async () => {
      delay = 1000;
      const sock = ws;
      try { await helloDone; } catch { sock.close(); return; }
      // A reconnect may have replaced `ws` while this handler was awaiting helloDone (the socket
      // dropped, close() rescheduled connect()); a stale handler must never act on behalf of a
      // socket that is no longer the live one.
      if (ws !== sock || sock.readyState !== WebSocket.OPEN) return;
      if (token) sendResume();
      else requestSeat();
    });
    ws.on("message", (b) => {
      let msg; try { msg = JSON.parse(String(b)); } catch { return; }
      onMessage(msg);
    });
    ws.on("error", (err) => emit({ type: "error", code: "socket", message: err.message }));
    ws.on("close", (code) => {
      if (code === 4000) { finish(new DriverError("seat_taken_over", "This seat is now open in another tab.")); return; }
      if (closed || settled) return;
      joinInFlight = false; resumeInFlight = false;
      emit({ type: "reconnecting", delayMs: delay });
      reconnectTimer = setTimeout(connect, delay);
      delay = Math.min(5000, delay * 1.5);
    });
  }
  connect();

  return {
    done, stats,
    // Test-only seams: `_receive` feeds any server message through the exact handler a ws
    // "message" takes; `_handleState` is the state subset; `_token` reads the resume token;
    // `_sendResume` does what the open handler does on a reconnect; `_dropSocket` kills the
    // socket without closing the driver, so a reconnect happens.
    _receive: onMessage,
    _handleState: onState,
    _token: () => token,
    _sendResume: sendResume,
    _dropSocket: () => { if (ws) ws.terminate(); },
    async close() {
      closed = true;
      latest = null;
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
      await adapter.shutdown();
    },
  };
}

if (require.main === module) {
  let a;
  try { a = parseArgs(process.argv.slice(2), { defaultUrl: "ws://localhost:3000" }); }
  catch (err) { if (!(err instanceof UsageError)) throw err; console.error(err.message); console.error(USAGE.replace(/flip7-agent/g, "node bench/live.js")); process.exit(1); }
  if (a.help) { console.log(USAGE.replace(/flip7-agent/g, "node bench/live.js")); process.exit(0); }
  const d = driveLiveSeat({ url: a.url, room: a.room, spec: a.spec, name: a.name });
  d.done.then(async () => { await d.close(); process.exit(0); }, async (err) => { console.error(err.message); await d.close(); process.exit(exitCodeFor(err)); });
}

module.exports = { driveLiveSeat, DriverError, exitCodeFor };
