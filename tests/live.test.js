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
