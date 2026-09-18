"use strict";
const WebSocket = require("ws");
const { resolveAgent } = require("../agents/adapter");
const { decide } = require("../agents/decide");
const { PROTOCOL } = require("../lib/request");

// Drives one adapter as a seat in a live room over the browser's own protocol.
// Lifecycle: hello once; start exactly once per game, on the first `playing` state seen since
// the last lobby/game_over (this also covers joining or reconnecting mid-game, where that first
// playing state may not be turn 1); end exactly once on game_over; shutdown on close(). An act is
// sent at most once per turnNumber per game.
function driveLiveSeat({ url, room, spec, name, log = console.log }) {
  const adapter = resolveAgent(spec);
  const stats = { decisions: 0, acts: 0, repeatedStates: 0, fallbacks: 0, serverErrors: 0 };
  let ws = null, you = null, token = null, closed = false, delay = 1000, reconnectTimer = null;
  let busy = false, latest = null, gameSerial = 0, inGame = false;
  const acted = new Set();
  let resolveDone, rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  const helloDone = adapter.hello().then((h) => { log(`agent ${h.name}@${h.version} ready`); return h; });
  helloDone.catch((err) => rejectDone(err));

  function send(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }

  async function handle(msg) {
    if (msg.phase === "lobby") { inGame = false; return; }
    const g = msg.game;
    if (!g) return;
    if (msg.phase === "playing" && !inGame) {
      // First playing state seen since the last lobby/game_over: a fresh game, or joining/
      // reconnecting mid-game. Either way this is the start of watching one game.
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
      resolveDone(msg);
      return;
    }
    if (!g.decision || g.current_player !== you) return;
    if (acted.has(g.turnNumber)) { stats.repeatedStates += 1; return; }
    const remaining = msg.timer ? msg.timer.remainingMs : 30000;
    const timeoutMs = Math.max(1, remaining - 250);
    const d = await decide(adapter, { gameView: g, gameId: `${room}#${gameSerial}`, timeoutMs, retry: false });
    stats.decisions += 1;
    if (d.fallback_used) stats.fallbacks += 1;
    if (acted.has(g.turnNumber)) { stats.repeatedStates += 1; return; }
    acted.add(g.turnNumber);
    stats.acts += 1;
    send({ type: "act", turnNumber: g.turnNumber, action: d.action });
  }

  // States that arrive while a decision is in flight are not dropped: the newest one is
  // reprocessed once the current decision settles.
  async function onState(msg) {
    if (msg.you) you = msg.you;
    latest = msg;
    if (busy) return;
    busy = true;
    try {
      while (latest) { const m = latest; latest = null; await handle(m); }
    } catch (err) { log("decision failed:", err.message); }
    finally { busy = false; }
  }

  function connect() {
    ws = new WebSocket(`${url.replace(/\/+$/, "")}/ws?room=${room}`);
    ws.on("open", async () => {
      delay = 1000;
      try { await helloDone; } catch { ws.close(); return; }
      if (token) send({ type: "resume", resumeToken: token });
      else send({ type: "join", name: name || adapter.name, agent: true });
    });
    ws.on("message", (b) => {
      let msg; try { msg = JSON.parse(String(b)); } catch { return; }
      if (msg.type === "joined") { you = msg.playerId; token = msg.resumeToken; log(`seated as ${you} in room ${room}`); }
      else if (msg.type === "state") onState(msg);
      else if (msg.type === "error") {
        if (msg.code === "stale_turn" || msg.code === "illegal_action" || msg.code === "not_your_turn") stats.serverErrors += 1;
        log(`server error: ${msg.code || ""} ${msg.message}`);
      }
    });
    ws.on("error", (err) => log("socket error", err.message));
    ws.on("close", (code) => {
      if (closed || code === 4000) { if (code === 4000) log("seat taken over; stopping"); return; }
      reconnectTimer = setTimeout(connect, delay);
      delay = Math.min(5000, delay * 1.5);
    });
  }
  connect();

  return {
    done, stats,
    // Test-only seam: feed a synthetic `state` message through the exact same handling path a
    // real ws message takes (onState -> handle), without a live connection. Used by
    // tests/live-unit.test.js to verify start()/end() call counts without a real server.
    _handleState: onState,
    async close() {
      closed = true;
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
      await adapter.shutdown();
    },
  };
}

if (require.main === module) {
  const a = {}; const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
  if (!a.room || !a.agent) { console.error("usage: node bench/live.js --url ws://localhost:3000 --room abcd --agent <spec> [--name my-agent]"); process.exit(1); }
  const d = driveLiveSeat({ url: a.url || "ws://localhost:3000", room: a.room, spec: a.agent, name: a.name });
  d.done.then(async (res) => {
    console.log(`game over: ${res.results.winnerName} wins`, res.results.standings);
    await d.close();
    process.exit(0);
  }, async (err) => { console.error(err.message); await d.close(); process.exit(1); });
}

module.exports = { driveLiveSeat };
