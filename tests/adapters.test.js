"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const engine = require("../lib/engine");
const { observeGame } = require("../lib/view");
const { resolveAgent, TimeoutError, AdapterError } = require("../agents/adapter");
const { decide, parseAction } = require("../agents/decide");

const FIX = (f) => path.join(__dirname, "fixtures", f);
const P2 = [{ id: "p1", name: "p1" }, { id: "p2", name: "p2" }];

async function playOne(adapter, timeoutMs = 2000) {
  await adapter.hello();
  let r = engine.step(engine.createGame({ players: P2, seed: 4 }), { type: "start_round" });
  await adapter.start({ type: "start", protocol: "flip7-agent/1", game_id: "t", you: "p2", players: r.state.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })) });
  const decisions = [];
  for (let i = 0; i < 200 && r.state.phase !== "game_over"; i++) {
    if (r.state.phase === "round_over") { r = engine.step(r.state, { type: "start_round" }); continue; }
    const id = engine.pendingPlayer(r.state);
    const d = await decide(adapter, { gameView: observeGame(r.state, id), gameId: "t", timeoutMs });
    decisions.push(d);
    r = engine.step(r.state, { type: "act", player: id, action: d.action });
  }
  await adapter.end({ type: "end", game_id: "t", result: { final_scores: {}, winner: r.state.winner, rounds: r.state.roundNumber } });
  await adapter.shutdown();
  return { state: r.state, decisions };
}

test("parseAction accepts JSON objects, JSON strings, and bare strings", () => {
  assert.deepEqual(parseAction('{"action":"hit"}', ["hit", "stay"]), { action: "hit" });
  assert.deepEqual(parseAction({ action: "stay" }, ["hit", "stay"]), { action: "stay" });
  assert.deepEqual(parseAction('"stay"', ["hit", "stay"]), { action: "stay" });
  assert.deepEqual(parseAction("hit", ["hit", "stay"]), { action: "hit" });
  assert.match(parseAction("hitt", ["hit", "stay"]).error, /illegal action "hitt"; legal: hit, stay/);
  assert.match(parseAction('{"foo":1}', ["hit"]).error, /no action/);
});

test("bot: and file: adapters play a game in-process", async () => {
  const bot = resolveAgent("bot:threshold25");
  const out = await playOne(bot);
  assert.equal(bot.name, "threshold25");
  assert.ok(out.decisions.length > 5);
  assert.ok(out.decisions.every((d) => d.attempts.length === 1 && d.attempts[0].outcome === "ok" && !d.fallback_used));
  const file = resolveAgent("file:./agents/examples/threshold.js");
  await file.hello();
  assert.equal(file.name, "example-threshold");
  await file.shutdown();
});

test("invalid reply is retried once with retry populated, then falls back", async () => {
  process.env.BAD_MODE = "once";
  const a = resolveAgent("file:" + FIX("agent-bad.js"));
  await a.hello();
  const s = engine.step(engine.createGame({ players: P2, seed: 4 }), { type: "start_round" }).state;
  const d = await decide(a, { gameView: observeGame(s, engine.pendingPlayer(s)), gameId: "t", timeoutMs: 1000 });
  assert.equal(d.attempts.length, 2);
  assert.equal(d.attempts[0].outcome, "invalid");
  assert.match(d.attempts[0].invalid_reason, /illegal action "nope"/);
  assert.equal(d.attempts[1].outcome, "ok");
  assert.equal(d.fallback_used, false);
  assert.ok(d.attempts[0].request_id !== d.attempts[1].request_id);

  process.env.BAD_MODE = "always";
  const b = resolveAgent("file:" + FIX("agent-bad.js") + "?fresh=1");
  await b.hello();
  const d2 = await decide(b, { gameView: observeGame(s, engine.pendingPlayer(s)), gameId: "t", timeoutMs: 1000 });
  assert.equal(d2.attempts.length, 2);
  assert.equal(d2.attempts[1].outcome, "invalid");
  assert.equal(d2.fallback_used, true);
  assert.equal(d2.action, "stay");
  delete process.env.BAD_MODE;
});

test("timeout is not retried and falls back; a late promise is ignored", async () => {
  process.env.BAD_MODE = "hang";
  const a = resolveAgent("file:" + FIX("agent-bad.js") + "?fresh=2");
  await a.hello();
  const s = engine.step(engine.createGame({ players: P2, seed: 4 }), { type: "start_round" }).state;
  const d = await decide(a, { gameView: observeGame(s, engine.pendingPlayer(s)), gameId: "t", timeoutMs: 50 });
  assert.equal(d.attempts.length, 1);
  assert.equal(d.attempts[0].outcome, "timeout");
  assert.equal(d.fallback_used, true);
  assert.equal(d.action, "stay");
  assert.ok(d.latency_ms >= 50);
  delete process.env.BAD_MODE;
});

test("subprocess adapter plays, captures stderr, retries invalid, discards late replies, aborts on crash", async () => {
  const cmd = `"${process.execPath}" "${FIX("agent-echo.js")}"`;
  const ok = resolveAgent("cmd:" + cmd);
  const out = await playOne(ok);
  assert.equal(ok.name, "echo");
  assert.ok(out.decisions.length > 5);
  assert.match(ok.stderr(), /move 1/);

  process.env.MODE = "invalid-once";
  const inv = resolveAgent("cmd:" + cmd);
  const out2 = await playOne(inv);
  assert.equal(out2.decisions[0].attempts.length, 2);
  assert.equal(out2.decisions[0].attempts[0].outcome, "invalid");

  process.env.MODE = "slow";
  const slow = resolveAgent("cmd:" + cmd);
  await slow.hello();
  const s = engine.step(engine.createGame({ players: P2, seed: 4 }), { type: "start_round" }).state;
  const d1 = await decide(slow, { gameView: observeGame(s, engine.pendingPlayer(s)), gameId: "t", timeoutMs: 50 });
  assert.equal(d1.attempts[0].outcome, "timeout");
  const d2 = await decide(slow, { gameView: observeGame(s, engine.pendingPlayer(s)), gameId: "t", timeoutMs: 1000 });
  assert.equal(d2.attempts[0].outcome, "ok", "the late reply to the first request was not consumed by the second");
  await slow.shutdown();

  process.env.MODE = "crash";
  const crash = resolveAgent("cmd:" + cmd);
  await assert.rejects(playOne(crash), (err) => err instanceof AdapterError && /code 3/.test(err.message));
  delete process.env.MODE;
});

test("http adapter plays, treats non-200 as invalid, times out, and rejects a protocol mismatch", async () => {
  async function startHttp(mode) {
    const child = spawn(process.execPath, [FIX("http-agent.js"), "0"], { env: { ...process.env, MODE: mode }, stdio: ["ignore", "pipe", "pipe"] });
    const port = await new Promise((resolve) => child.stdout.on("data", (b) => { const m = String(b).match(/listening (\d+)/); if (m) resolve(Number(m[1])); }));
    return { url: `http://127.0.0.1:${port}`, stop: () => child.kill() };
  }
  const h = await startHttp("ok");
  const a = resolveAgent(h.url);
  const out = await playOne(a);
  assert.equal(a.name, "httpecho");
  assert.ok(out.decisions.length > 5);
  h.stop();

  const h2 = await startHttp("invalid-once");
  const out2 = await playOne(resolveAgent(h2.url));
  assert.equal(out2.decisions[0].attempts[0].outcome, "invalid");
  h2.stop();

  const h3 = await startHttp("slow");
  const slow = resolveAgent(h3.url);
  await slow.hello();
  const s = engine.step(engine.createGame({ players: P2, seed: 4 }), { type: "start_round" }).state;
  const d = await decide(slow, { gameView: observeGame(s, engine.pendingPlayer(s)), gameId: "t", timeoutMs: 50 });
  assert.equal(d.attempts[0].outcome, "timeout");
  h3.stop();

  const h4 = await startHttp("wrong-protocol");
  await assert.rejects(resolveAgent(h4.url).hello(), AdapterError);
  h4.stop();

  await assert.rejects(resolveAgent("http://127.0.0.1:1").hello(), AdapterError);
});
