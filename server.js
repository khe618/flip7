"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const express = require("express");
const { WebSocketServer } = require("ws");
const { readConfig } = require("./lib/config");
const { createRegistry, MIN_PLAYERS, MAX_PLAYERS, normaliseName } = require("./lib/rooms");
const { createRoomGame } = require("./lib/room-game");
const { buildState } = require("./lib/snapshot");

const config = readConfig(process.env);
const PUBLIC = path.join(__dirname, "public");
const shell = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8"); // cached: restart after editing
const protocolDoc = fs.readFileSync(path.join(__dirname, "docs", "agent-protocol.md"), "utf8");

const app = express();
app.disable("x-powered-by");
app.get("/health", (req, res) => res.type("text/plain").send("ok"));
app.get("/agent-protocol", (req, res) => res.type("text/plain; charset=utf-8").send(protocolDoc));
app.get("/api/new-room", (req, res) => {
  const code = registry.reserveCode();
  res.set("Cache-Control", "no-store");
  if (!code) return res.status(503).json({ ok: false, error: "no_room_available" });
  res.json({ ok: true, room: code });
});
app.get(["/", "/how-to-play", "/connect-an-agent", /^\/[a-z]{4}$/], (req, res) => res.type("html").send(shell));
app.use(express.static(PUBLIC, { index: false }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: config.MAX_PAYLOAD });

function send(ws, obj) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); }
// room-game's own onChange (armed by act/start-game/next-round, called synchronously) and the
// trailing broadcast after every ws message can both fire for the same underlying change, which
// would otherwise send two `state` frames to every recipient for one change (this raced: the
// second frame's `timer.remainingMs` is computed fresh and can differ by a millisecond from the
// first, so comparing rendered JSON to dedupe was not reliable). A live agent driver treats each
// `state` as a fresh thing to react to, so a duplicate looks like a second, already-answered
// decision. `room._broadcastTick` is bumped on every actual broadcast; the ws message handler
// records the tick before dispatching and skips its trailing broadcast if onChange already
// bumped it during that synchronous call.
function broadcast(room) {
  room._broadcastTick = (room._broadcastTick || 0) + 1;
  for (const seat of room.seats.values()) if (seat.ws) send(seat.ws, buildState(room, seat.id));
  for (const ws of room.visitors) send(ws, buildState(room, null));
}
function log(...a) { console.log(new Date().toISOString(), ...a); }

const registry = createRegistry({
  now: Date.now, setTimeout, clearTimeout,
  randomInt: (max) => crypto.randomInt(max), randomBytes: (n) => crypto.randomBytes(n),
  config, onChange: broadcast, onDelete: (code) => log(`[room ${code}] deleted`),
});

function startGame(room) {
  for (const seat of [...room.seats.values()]) if (!seat.isBot && !seat.connected) registry.removeSeat(room, seat.id);
  if (room.seats.size < MIN_PLAYERS) throw Object.assign(new Error(`need at least ${MIN_PLAYERS} players`), { code: "not_enough_players" });
  if (room.game) room.game.dispose();
  room.game = createRoomGame({
    config, now: Date.now, setTimeout, clearTimeout, random: Math.random, seed: () => crypto.randomInt(2 ** 31),
    onChange: () => {
      if (registry.get(room.code) !== room) return;
      // Seat expiry only runs in lobby and game_over (spec §4.5), so the phase flip is also the moment
      // a seat that disconnected mid-game starts its clock: sweep before broadcasting, so the
      // game_over frame already reflects any seat whose TTL elapsed while the game was still running.
      if (room.game && room.game.phase === "game_over" && room.phase !== "game_over") { room.phase = "game_over"; registry.sweep(room); }
      broadcast(room);
    },
    log,
  });
  room.phase = "playing";
  room.game.start([...room.seats.values()].map((s) => ({ id: s.id, name: s.name, isBot: s.isBot, botPolicy: s.botPolicy })));
}

function returnToLobby(room) {
  if (room.game) { room.game.dispose(); room.game = null; }
  room.phase = "lobby";
  registry.sweep(room);
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const code = url.searchParams.get("room") || "";
  if (!/^[a-z]{4}$/.test(code)) { ws.close(1008, "room_required"); return; }
  let room = registry.getOrCreate(code);
  let seat = null;
  registry.attachVisitor(room, ws);
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("error", (err) => log(`[ws ${code}] error`, err.message));
  send(ws, buildState(room, null));

  const requireSeated = () => { if (!seat || seat.ws !== ws) throw Object.assign(new Error("Sit down first."), { code: "not_seated" }); };

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return send(ws, { type: "error", message: "bad json" }); }
    if (!msg || typeof msg.type !== "string") return;
    // Re-resolve the room: the registry may have deleted and recreated it under us.
    if (registry.get(room.code) !== room) { room = registry.getOrCreate(room.code); registry.attachVisitor(room, ws); seat = null; }
    if (seat && seat.ws !== ws) return; // displaced socket
    const tickBefore = room._broadcastTick || 0; // room-game's onChange may already broadcast below
    try {
      switch (msg.type) {
        case "resume": {
          const s = registry.resume(room, String(msg.resumeToken || ""), ws);
          if (!s) { send(ws, { type: "error", code: "unknown_token", message: "Unknown session." }); break; }
          seat = s; registry.detachVisitor(room, ws);
          send(ws, { type: "joined", playerId: seat.id, resumeToken: seat.resumeToken });
          break;
        }
        case "join":
        case "quick-play": {
          let s = msg.resumeToken ? registry.resume(room, String(msg.resumeToken), ws) : null;
          const wasEmpty = room.seats.size === 0;
          if (!s) s = registry.join(room, { name: normaliseName(msg.name), ws, isAgent: msg.agent === true });
          seat = s; registry.detachVisitor(room, ws);
          send(ws, { type: "joined", playerId: seat.id, resumeToken: seat.resumeToken });
          if (msg.type === "quick-play" && wasEmpty) { for (let i = 0; i < 3; i++) registry.addBot(room); startGame(room); }
          break;
        }
        case "add-bot": requireSeated(); if (room.phase !== "lobby") break; if (room.seats.size >= MAX_PLAYERS) throw Object.assign(new Error("Room is full."), { code: "room_full" }); registry.addBot(room); break;
        case "remove-bot": requireSeated(); if (room.phase !== "lobby") break; registry.removeBot(room, String(msg.playerId || "")); break;
        case "start-game": requireSeated(); if (room.phase !== "lobby") break; startGame(room); break;
        case "act": requireSeated(); if (!room.game) throw Object.assign(new Error("No game."), { code: "stale_turn" }); room.game.act(seat.id, Number(msg.turnNumber), String(msg.action)); break;
        case "next-round": requireSeated(); if (room.game) room.game.nextRound(Number(msg.roundNumber)); break;
        case "return-to-lobby": requireSeated(); if (room.phase === "game_over") returnToLobby(room); break;
        default: send(ws, { type: "error", message: `unknown message ${msg.type}` });
      }
    } catch (err) {
      send(ws, { type: "error", code: err.code || "error", message: err.message });
    }
    if (registry.get(room.code) === room && (room._broadcastTick || 0) === tickBefore) broadcast(room);
  });

  ws.on("close", () => {
    if (registry.get(room.code) !== room) return;
    if (seat) { if (seat.ws === ws) registry.disconnect(room, ws); }
    else registry.detachVisitor(room, ws);
    if (registry.get(room.code) === room) broadcast(room);
  });
});

// The try/catch is per client: one socket that throws on terminate/ping must not skip the sweep
// for every client after it in the set.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    try { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
    catch (err) { log("[heartbeat] failed", err); }
  }
}, config.HEARTBEAT_MS);
heartbeat.unref();
wss.on("close", () => clearInterval(heartbeat));

function crash(label, err) {
  console.error(`[fatal] ${label}`, err);
  process.exitCode = 1;
  try { for (const ws of wss.clients) ws.close(1012, "restarting"); server.close(); } catch { /* ignore */ }
  setTimeout(() => process.exit(1), 500);   // referenced on purpose: the exit must happen
}
process.on("uncaughtException", (err) => crash("uncaughtException", err));
process.on("unhandledRejection", (err) => crash("unhandledRejection", err));

server.listen(config.PORT, () => log(`flip7-arena running at http://localhost:${server.address().port}`));
