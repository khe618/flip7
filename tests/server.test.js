"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");

let PORT = 0;   // the server picks a free port (PORT=0) and logs it
let child;

test.before(async () => {
  child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    // ROUND_SUMMARY_MS is long so the full-game test drives next-round itself and never misses a summary.
    // TURN_MS is 2 s: the round-trip tests always act immediately, so the turn timer only matters if a
    // test stalls; keeping it wide avoids racing the default 3000 ms `until()` timeout against a tight
    // auto-turn timer. The full-game test drives its own 20 ms poll loop and is unaffected either way.
    env: { ...process.env, PORT: "0", RESUME_TTL_MS: "400", TURN_MS: "2000", ROUND_SUMMARY_MS: "5000", BOT_DELAY_MIN_MS: "5", BOT_DELAY_MAX_MS: "10" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  PORT = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start within 10 s")), 10000);
    child.stdout.on("data", (b) => { const m = String(b).match(/running at http:\/\/localhost:(\d+)/); if (m) { clearTimeout(t); resolve(Number(m[1])); } });
    child.stderr.on("data", (b) => process.stderr.write(b));
    child.on("exit", (code) => { clearTimeout(t); reject(new Error(`server exited ${code}`)); });
  });
});
test.after(() => { child.kill(); });

let roomSeq = 0;
function uniqueRoom() { roomSeq++; return "t" + String.fromCharCode(97 + Math.floor(roomSeq / 26)) + String.fromCharCode(97 + (roomSeq % 26)) + "q"; }

function connect(room) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${room}`);
  const messages = [];
  const waiters = new Set();
  ws.on("message", (b) => { const m = JSON.parse(String(b)); messages.push(m); for (const w of [...waiters]) w(); });
  const closed = new Promise((resolve) => ws.on("close", (code, reason) => resolve({ code, reason: String(reason) })));
  return {
    ws, messages, closed,
    open: () => new Promise((resolve) => ws.on("open", resolve)),
    send: (obj) => ws.send(JSON.stringify(obj)),
    last: (type) => [...messages].reverse().find((m) => m.type === type),
    // Resolves with the first message (from index `from`) matching pred; the waiter stays
    // registered until it matches, so non-matching messages in between do not drop it.
    // Default is 10 s because this shared machine runs many node processes; a healthy server answers in milliseconds.
    until(pred, label, from = 0, timeoutMs = 10000) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { waiters.delete(check); reject(new Error(`timeout waiting for ${label}`)); }, timeoutMs);
        const check = () => {
          const m = messages.slice(from).find((x) => { try { return pred(x); } catch { return false; } });
          if (m) { clearTimeout(t); waiters.delete(check); resolve(m); }
        };
        waiters.add(check);
        check();
      });
    },
  };
}

test("routes: app shell, new-room, health, agent-protocol, unknown", async () => {
  const base = `http://127.0.0.1:${PORT}`;
  assert.equal((await fetch(base + "/health")).status, 200);
  assert.equal(await (await fetch(base + "/health")).text(), "ok");
  const r = await (await fetch(base + "/api/new-room")).json();
  assert.match(r.room, /^[a-z]{4}$/);
  assert.ok((await (await fetch(base + "/")).text()).toLowerCase().includes("<!doctype html>"));
  assert.equal((await fetch(base + "/" + r.room)).status, 200);
  assert.equal((await fetch(base + "/agent-protocol")).headers.get("content-type").split(";")[0], "text/plain");
  assert.equal((await fetch(base + "/zzzzz")).status, 404);
});

test("quick play seats you with three bots and deals", async () => {
  const c = connect(uniqueRoom());
  await c.open();
  c.send({ type: "quick-play", name: "Kay" });
  const joined = await c.until((m) => m.type === "joined", "joined");
  assert.match(joined.resumeToken, /^[0-9a-f]{32}$/);
  const st = await c.until((m) => m.type === "state" && m.phase === "playing", "playing state");
  assert.equal(st.seats.length, 4);
  assert.equal(st.seats.filter((s) => s.isBot).length, 3);
  assert.equal(st.you, joined.playerId);
  assert.ok(st.game && st.game.players.length === 4);
  c.ws.close();
});

test("join, add bot, start; act round trip; stale act rejected; visitors get the tiny shape", async () => {
  const room = uniqueRoom();
  const a = connect(room); await a.open();
  const v = connect(room); await v.open();
  const vs = await v.until((m) => m.type === "state", "visitor state");
  assert.equal(vs.you, null); assert.equal("seats" in vs, false);
  a.send({ type: "join", name: "Kay" });
  await a.until((m) => m.type === "joined", "joined");
  v.send({ type: "add-bot" });
  const err = await v.until((m) => m.type === "error" && m.code === "not_seated", "visitor refused");
  assert.ok(err);
  a.send({ type: "add-bot" });
  await a.until((m) => m.type === "state" && m.seats.length === 2, "bot added");
  a.send({ type: "start-game" });
  const st = await a.until((m) => m.type === "state" && m.phase === "playing" && m.game, "playing");
  const me = st.you;
  const mine = await a.until((m) => m.type === "state" && m.game && m.game.current_player === me && m.game.decision, "my decision");
  a.send({ type: "act", turnNumber: mine.game.turnNumber - 1, action: "stay" });
  await a.until((m) => m.type === "error" && m.code === "stale_turn", "stale rejected");
  a.send({ type: "act", turnNumber: mine.game.turnNumber, action: "banana" });
  await a.until((m) => m.type === "error" && m.code === "illegal_action", "illegal rejected");
  a.send({ type: "act", turnNumber: mine.game.turnNumber, action: mine.game.legal_actions[0] });
  await a.until((m) => m.type === "state" && m.game && m.game.turnNumber > mine.game.turnNumber, "advanced");
  a.ws.close(); v.ws.close();
});

test("resume displaces the old socket with 4000 while it is still open; the old socket cannot act", async () => {
  const room = uniqueRoom();
  const a = connect(room); await a.open();
  a.send({ type: "join", name: "Kay" });
  const joined = await a.until((m) => m.type === "joined", "joined");
  const b = connect(room); await b.open();
  b.send({ type: "resume", resumeToken: joined.resumeToken });
  await b.until((m) => m.type === "joined" && m.playerId === joined.playerId, "resumed");
  const closed = await a.closed;
  assert.equal(closed.code, 4000);
  const c = connect(room); await c.open();
  c.send({ type: "resume", resumeToken: "nope" });
  await c.until((m) => m.type === "error" && m.code === "unknown_token", "unknown token");
  b.ws.close(); c.ws.close();
});

test("agent join sets the badge and keeps the room alive past the TTL without humans", async () => {
  const room = uniqueRoom();
  const h = connect(room); await h.open();
  h.send({ type: "join", name: "Kay" });
  await h.until((m) => m.type === "joined", "joined");
  const ag = connect(room); await ag.open();
  ag.send({ type: "join", name: "my-agent", agent: true });
  const st = await ag.until((m) => m.type === "state" && m.seats && m.seats.some((s) => s.isAgent), "agent badge");
  assert.equal(st.seats.find((s) => s.isAgent).name, "my-agent");
  h.ws.close();
  await new Promise((r) => setTimeout(r, 600));
  const probe = connect(room); await probe.open();
  const ps = await probe.until((m) => m.type === "state", "probe state");
  assert.equal(ps.playerCount, 1, "the human's lobby seat expired, but the connected agent kept the room alive");
  ag.ws.close(); probe.ws.close();
});

test("oversized frames close with 1009", async () => {
  const c = connect(uniqueRoom()); await c.open();
  c.ws.send("x".repeat(20000));
  const closed = await c.closed;
  assert.equal(closed.code, 1009);
});

test("a full two-player game reaches game_over with scores equal to the sum of round results", async () => {
  const room = uniqueRoom();
  const a = connect(room); await a.open();
  const b = connect(room); await b.open();
  a.send({ type: "join", name: "A" }); b.send({ type: "join", name: "B" });
  await a.until((m) => m.type === "joined", "a joined"); await b.until((m) => m.type === "joined", "b joined");
  a.send({ type: "start-game" });
  const totals = {};
  let roundsSeen = 0;
  const deadline = Date.now() + 60000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("game did not finish");
    const st = a.last("state");
    if (st && st.phase === "game_over") break;
    for (const c of [a, b]) {
      const s = c.last("state");
      if (s && s.game && s.game.decision && s.game.current_player === s.you) {
        const me = s.game.players.find((p) => p.id === s.you);
        const action = s.game.legal_actions.includes("hit") ? (me.round_score < 15 ? "hit" : "stay") : s.game.legal_actions[0];
        c.send({ type: "act", turnNumber: s.game.turnNumber, action });
      }
    }
    const rs = a.last("state");
    if (rs && rs.roundSummary && rs.roundSummary.round > roundsSeen) {
      roundsSeen = rs.roundSummary.round;
      for (const row of rs.roundSummary.rows) totals[row.id] = (totals[row.id] || 0) + row.roundScore;
      a.send({ type: "next-round", roundNumber: rs.roundSummary.round });
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  const fin = a.last("state");
  assert.ok(fin.results.winner);
  // the winning round goes straight to game_over, so its scores come from the final game view
  for (const [id, res] of Object.entries(fin.game.results)) totals[id] = (totals[id] || 0) + res.roundScore;
  for (const row of fin.results.standings) assert.equal(row.score, totals[row.id] || 0);
  a.ws.close(); b.ws.close();
});
