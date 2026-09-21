"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");

const BIN = path.join(__dirname, "..", "bin", "flip7-agent.js");

// Runs the bin to completion with a deadline; on the deadline the child is killed and the
// promise rejects, so a hung CLI fails the test instead of the suite.
function runBin(args, env = {}, ms = 90000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (b) => { stdout += b; }); child.stderr.on("data", (b) => { stderr += b; });
    const t = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`bin did not exit within ${ms / 1000} s\n${stdout}\n${stderr}`)); }, ms);
    child.on("close", (code) => { clearTimeout(t); resolve({ code, stdout, stderr }); });
  });
}

test("usage errors exit 1 with usage; --help and --version exit 0", async () => {
  const none = await runBin([]);
  assert.equal(none.code, 1); assert.match(none.stderr, /usage: flip7-agent/);
  const badLink = await runBin(["https://flip7-arena.onrender.com/", "--agent", "bot:threshold25"]);
  assert.equal(badLink.code, 1); assert.match(badLink.stderr, /room code/);
  const badUrl = await runBin(["abcd", "--agent", "bot:threshold25", "--url", "nonsense"]);
  assert.equal(badUrl.code, 1);
  const help = await runBin(["--help"]);
  assert.equal(help.code, 0); assert.match(help.stdout, /usage: flip7-agent/);
  const version = await runBin(["--version"]);
  assert.equal(version.code, 0); assert.match(version.stdout, /^\d+\.\d+\.\d+/);
});

test("adapter failures exit 2 with a clear message", async () => {
  const spec = await runBin(["abcd", "--agent", "nope:x", "--url", "ws://127.0.0.1:1"]);
  assert.equal(spec.code, 2); assert.match(spec.stderr, /unrecognised agent spec/);
  const missing = await runBin(["abcd", "--agent", "claude-code", "--url", "ws://127.0.0.1:1"], { FLIP7_CLAUDE_COMMAND: "flip7-definitely-not-installed-xyz" });
  assert.equal(missing.code, 2); assert.match(missing.stderr, /not found on PATH/);
});

let PORT = 0, server;
test.before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT: "0", TURN_MS: "2000", ROUND_SUMMARY_MS: "30", BOT_DELAY_MIN_MS: "5", BOT_DELAY_MAX_MS: "10" }, stdio: ["ignore", "pipe", "pipe"] });
  PORT = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start within 10 s")), 10000);
    server.stdout.on("data", (b) => { const m = String(b).match(/running at http:\/\/localhost:(\d+)/); if (m) { clearTimeout(t); resolve(Number(m[1])); } });
  });
});
test.after(() => server && server.kill());

// A human socket that adds one bot and starts once an agent is seated, and always stays.
async function host(room) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=${room}`);
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ type: "join", name: "Kay" }));
  let started = false;
  ws.on("message", (b) => {
    const m = JSON.parse(String(b));
    if (m.type === "state" && m.phase === "lobby" && (m.seats || []).some((s) => s.isAgent) && !started) { started = true; ws.send(JSON.stringify({ type: "add-bot" })); ws.send(JSON.stringify({ type: "start-game" })); }
    if (m.type === "state" && m.game && m.game.decision && m.game.current_player === m.you) ws.send(JSON.stringify({ type: "act", turnNumber: m.game.turnNumber, action: "stay" }));
  });
  return ws;
}

test("a bot seat plays a game from a room link and exits 0 with the standings", async () => {
  const room = "binz";
  const ws = await host(room);
  try {
    const r = await runBin([`http://127.0.0.1:${PORT}/${room}`, "--agent", "bot:threshold25", "--name", "cli"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /agent threshold25@/);
    assert.match(r.stdout, new RegExp(`seated as s\\d+ in room ${room}`));
    assert.match(r.stdout, /turn \d+: (hit|stay) \(\d+\.\d s\)/);
    assert.match(r.stdout, /game over: .*\d/);
  } finally {
    ws.close();
  }
});

test("--quiet drops decision lines", async () => {
  const room = "quie";
  const ws = await host(room);
  try {
    const r = await runBin([`http://127.0.0.1:${PORT}/${room}`, "--agent", "bot:threshold25", "--quiet"]);
    assert.equal(r.code, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /turn \d+:/);
    assert.match(r.stdout, /game over/);
  } finally {
    ws.close();
  }
});

test("SIGINT during a game exits 130 after shutdown", { skip: process.platform === "win32" && "Windows cannot deliver SIGINT to a child" }, async () => {
  const room = "sigi";
  const child = spawn(process.execPath, [BIN, `http://127.0.0.1:${PORT}/${room}`, "--agent", "bot:threshold25"], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => { const t = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("never seated")); }, 10000); child.stdout.on("data", (b) => { if (/seated as/.test(String(b))) { clearTimeout(t); resolve(); } }); });
  const started = Date.now();
  child.kill("SIGINT");
  const code = await new Promise((resolve, reject) => { const t = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("did not exit")); }, 6000); child.on("close", (c) => { clearTimeout(t); resolve(c); }); });
  assert.equal(code, 130);
  assert.ok(Date.now() - started < 4000);
});
