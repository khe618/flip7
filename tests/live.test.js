"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");
const { driveLiveSeat } = require("../bench/live");

let PORT = 0;
let child;
test.before(async () => {
  child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT: "0", TURN_MS: "2000", ROUND_SUMMARY_MS: "30", BOT_DELAY_MIN_MS: "5", BOT_DELAY_MAX_MS: "10" }, stdio: ["ignore", "pipe", "pipe"] });
  PORT = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start within 10 s")), 10000);
    child.stdout.on("data", (b) => { const m = String(b).match(/running at http:\/\/localhost:(\d+)/); if (m) { clearTimeout(t); resolve(Number(m[1])); } });
    child.on("exit", (code) => { clearTimeout(t); reject(new Error(`server exited ${code}`)); });
  });
});
test.after(() => child.kill());

test("an in-process agent takes a live seat, plays a whole game against bots, and acts once per turn", async () => {
  const room = "live" ;
  const driver = driveLiveSeat({ url: `ws://127.0.0.1:${PORT}`, room, spec: "bot:threshold25", name: "drv", log: () => {} });
  // a human-like socket adds bots and starts once the agent is seated
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${room}`);
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ type: "join", name: "Kay" }));
  let started = false;
  ws.on("message", (b) => {
    const m = JSON.parse(String(b));
    if (m.type === "state" && m.phase === "lobby" && m.seats && m.seats.some((s) => s.isAgent) && !started) {
      started = true;
      ws.send(JSON.stringify({ type: "add-bot" })); ws.send(JSON.stringify({ type: "add-bot" }));
      ws.send(JSON.stringify({ type: "start-game" }));
    }
    if (m.type === "state" && m.game && m.game.decision && m.game.current_player === m.you) {
      ws.send(JSON.stringify({ type: "act", turnNumber: m.game.turnNumber, action: "stay" }));
    }
  });
  const result = await Promise.race([driver.done, new Promise((_, reject) => setTimeout(() => reject(new Error("game did not finish within 60 s")), 60000).unref())]);
  assert.ok(result.results && result.results.winner);
  assert.ok(driver.stats.decisions > 3);
  assert.equal(driver.stats.acts, driver.stats.decisions);
  assert.equal(driver.stats.serverErrors, 0);
  // One frame per change: the server suppresses its trailing broadcast when the room game already
  // broadcast for the same message, so no already-answered turn is ever handed to the driver twice.
  assert.equal(driver.stats.repeatedStates, 0);
  assert.ok(driver.stats.acts >= 1);
  await driver.close(); ws.close();
});

// Bounded wait: rejects instead of hanging the suite.
function waitFor(pred, what, ms = 10000) {
  return new Promise((resolve, reject) => {
    const end = Date.now() + ms;
    const i = setInterval(() => { if (pred()) { clearInterval(i); resolve(); } else if (Date.now() > end) { clearInterval(i); reject(new Error(`${what} did not happen within ${ms / 1000} s`)); } }, 20);
  });
}

// A human-like socket that seats itself, always stays, and exposes what it saw.
async function human(room, humanName = "Kay") {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${room}`);
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ type: "join", name: humanName }));
  const seen = [];
  ws.on("message", (b) => {
    const m = JSON.parse(String(b)); seen.push(m);
    if (m.type === "state" && m.game && m.game.decision && m.game.current_player === m.you) ws.send(JSON.stringify({ type: "act", turnNumber: m.game.turnNumber, action: "stay" }));
  });
  const send = (o) => ws.send(JSON.stringify(o));
  const until = (pred, what, ms = 60000) => new Promise((resolve, reject) => {
    const hit = seen.find(pred); if (hit) { resolve(hit); return; }
    let t;
    const listener = (b) => { const m = JSON.parse(String(b)); if (pred(m)) { clearTimeout(t); ws.off("message", listener); resolve(m); } };
    t = setTimeout(() => { ws.off("message", listener); reject(new Error(`${what} did not happen within ${ms / 1000} s`)); }, ms).unref();
    ws.on("message", listener);
  });
  return { ws, seen, send, until, close: () => ws.close() };
}
const isLobby = (m) => m.type === "state" && m.phase === "lobby";
const agentSeats = (m) => (m.seats || []).filter((s) => s.isAgent).length;
const URL_ = () => `ws://127.0.0.1:${PORT}`;

test("a driver that connects mid-game waits, then holds exactly one seat after the room returns to the lobby", async () => {
  const room = "midg";
  const h = await human(room);
  await h.until(isLobby, "lobby");
  h.send({ type: "add-bot" }); h.send({ type: "add-bot" }); h.send({ type: "start-game" });
  await h.until((m) => m.type === "state" && m.phase === "playing", "game start");
  const events = [];
  const driver = driveLiveSeat({ url: URL_(), room, spec: "bot:threshold25", name: "late", onEvent: (e) => events.push(e) });
  driver.done.catch(() => {});
  await waitFor(() => events.some((e) => e.type === "waiting"), "waiting event");
  await h.until((m) => m.type === "state" && m.phase === "game_over", "first game over", 90000);
  assert.equal(events.filter((e) => e.type === "seated").length, 0, "not seated during the game");
  h.send({ type: "return-to-lobby" });
  const lobby = await h.until((m) => isLobby(m) && agentSeats(m) === 1, "driver seated in the lobby", 10000);
  assert.equal(agentSeats(lobby), 1);
  await waitFor(() => events.filter((e) => e.type === "seated").length === 1, "one seated event");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(events.filter((e) => e.type === "seated").length, 1, "seated exactly once");
  assert.equal(driver.stats.decisions, 0, "no decisions were taken as a visitor");
  await driver.close(); h.close();
});

test("a dropped socket reconnects with the same token and the room still has exactly one driver seat", async () => {
  const room = "recn";
  const h = await human(room);
  const events = [];
  const driver = driveLiveSeat({ url: URL_(), room, spec: "bot:threshold25", name: "flaky", onEvent: (e) => events.push(e) });
  driver.done.catch(() => {});
  await h.until((m) => isLobby(m) && agentSeats(m) === 1, "driver seated", 10000);
  const token = driver._token();
  assert.ok(token);
  driver._dropSocket();
  await waitFor(() => events.some((e) => e.type === "reconnecting"), "reconnecting event");
  await waitFor(() => events.filter((e) => e.type === "seated").length === 2, "seated again after resume", 10000);
  assert.equal(driver._token(), token, "the resume kept the same seat");
  await new Promise((r) => setTimeout(r, 300));
  const last = [...h.seen].reverse().find(isLobby);
  assert.equal(agentSeats(last), 1, "no duplicate seat from a join racing the resume");
  await driver.close(); h.close();
});

test("two drivers in one room both play a full game", async () => {
  const room = "duoo";
  const h = await human(room);
  const a = driveLiveSeat({ url: URL_(), room, spec: "bot:threshold25", name: "alpha", log: () => {} });
  const b = driveLiveSeat({ url: URL_(), room, spec: "bot:threshold25", name: "beta", log: () => {} });
  await h.until((m) => isLobby(m) && agentSeats(m) === 2, "both agents seated", 10000);
  h.send({ type: "start-game" });
  const [ra, rb] = await Promise.race([Promise.all([a.done, b.done]), new Promise((_, reject) => setTimeout(() => reject(new Error("game did not finish within 90 s")), 90000).unref())]);
  assert.ok(ra.results.winner && rb.results.winner);
  assert.ok(a.stats.acts >= 1 && b.stats.acts >= 1);
  assert.equal(a.stats.serverErrors + b.stats.serverErrors, 0);
  await a.close(); await b.close(); h.close();
});

test("a resume from another socket takes the seat over and rejects done with seat_taken_over", async () => {
  const room = "take";
  const driver = driveLiveSeat({ url: URL_(), room, spec: "bot:threshold25", name: "orig", log: () => {} });
  await waitFor(() => Boolean(driver._token()), "driver seated");
  const thief = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${room}`);
  await new Promise((r) => thief.on("open", r));
  thief.send(JSON.stringify({ type: "resume", resumeToken: driver._token() }));
  await assert.rejects(Promise.race([driver.done, new Promise((_, reject) => setTimeout(() => reject(new Error("no takeover within 5 s")), 5000).unref())]), (err) => err.code === "seat_taken_over");
  await driver.close(); thief.close();
});
