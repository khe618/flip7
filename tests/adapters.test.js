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

async function startHttp(mode) {
  const child = spawn(process.execPath, [FIX("http-agent.js"), "0"], { env: { ...process.env, MODE: mode }, stdio: ["ignore", "pipe", "pipe"] });
  const port = await new Promise((resolve) => child.stdout.on("data", (b) => { const m = String(b).match(/listening (\d+)/); if (m) resolve(Number(m[1])); }));
  return { url: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

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

test("subprocess: an over-size stdout line (§5.1, LINE_CAP) is invalid and retried", async () => {
  const cmd = `"${process.execPath}" "${FIX("agent-echo.js")}"`;
  process.env.MODE = "huge";
  const a = resolveAgent("cmd:" + cmd);
  await a.hello();
  const s = engine.step(engine.createGame({ players: P2, seed: 4 }), { type: "start_round" }).state;
  const d = await decide(a, { gameView: observeGame(s, engine.pendingPlayer(s)), gameId: "t", timeoutMs: 1000 });
  assert.equal(d.attempts.length, 2);
  assert.equal(d.attempts[0].outcome, "invalid");
  assert.equal(d.attempts[1].outcome, "ok");
  await a.shutdown();
  delete process.env.MODE;
});

test("http: an over-size /move body (BODY_CAP) is invalid and retried", async () => {
  const h = await startHttp("huge");
  const a = resolveAgent(h.url);
  await a.hello();
  const s = engine.step(engine.createGame({ players: P2, seed: 4 }), { type: "start_round" }).state;
  const d = await decide(a, { gameView: observeGame(s, engine.pendingPlayer(s)), gameId: "t", timeoutMs: 1000 });
  assert.equal(d.attempts.length, 2);
  assert.equal(d.attempts[0].outcome, "invalid");
  assert.match(d.attempts[0].raw_response, /^reply body over 64 KB/);
  assert.equal(d.attempts[1].outcome, "ok");
  h.stop();
});

test("subprocess: shutdown() kills a hung process (§8) and leaves no orphan", async () => {
  const cmd = `"${process.execPath}" "${FIX("agent-echo.js")}"`;
  process.env.MODE = "hang-shutdown";
  const a = resolveAgent("cmd:" + cmd);
  await a.hello();
  const started = Date.now();
  await a.shutdown();
  assert.ok(Date.now() - started < 4000, "shutdown should resolve within a few seconds of the 2s kill timeout");
  // The exit handler (registered in hello()) records the exit before shutdown()'s own
  // listener resolves, so the process is already marked exited: a subsequent move()
  // must reject with an AdapterError mentioning the exit rather than hanging again.
  await assert.rejects(
    a.move({ request_id: "x", request: {} }, 1000),
    (err) => err instanceof AdapterError && /exited/.test(err.message),
  );
  delete process.env.MODE;
});

test("in-process: a reply that resolves after the deadline is ignored, and a later decide succeeds", async () => {
  process.env.BAD_MODE = "late";
  const a = resolveAgent("file:" + FIX("agent-bad.js") + "?fresh=3");
  await a.hello();
  const s = engine.step(engine.createGame({ players: P2, seed: 4 }), { type: "start_round" }).state;
  let unhandled = null;
  const onUnhandled = (err) => { unhandled = err; };
  process.on("unhandledRejection", onUnhandled);
  const d = await decide(a, { gameView: observeGame(s, engine.pendingPlayer(s)), gameId: "t", timeoutMs: 30 });
  assert.equal(d.attempts[0].outcome, "timeout");
  assert.equal(d.fallback_used, true);
  assert.equal(d.action, "stay");
  // Give the fixture's ~150ms-late promise time to settle after the timeout fired.
  await new Promise((resolve) => setTimeout(resolve, 200));
  process.removeListener("unhandledRejection", onUnhandled);
  assert.equal(unhandled, null, "the late resolution must not surface as an unhandled rejection or a thrown error");
  const d2 = await decide(a, { gameView: observeGame(s, engine.pendingPlayer(s)), gameId: "t", timeoutMs: 1000 });
  assert.equal(d2.attempts[0].outcome, "ok");
  delete process.env.BAD_MODE;
});

const os = require("node:os");
const fs = require("node:fs");
const CLAUDE_CMD = [process.execPath, FIX("fake-claude.js")];
const ENV_KEYS = ["FAKE_CLAUDE_MODE", "FAKE_CLAUDE_COUNTER", "FAKE_CLAUDE_PIDFILE", "CLAUDECODE"];
let envSnapshot = null;
test.beforeEach(() => { envSnapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); });
test.afterEach(() => { for (const k of ENV_KEYS) { if (envSnapshot[k] === undefined) delete process.env[k]; else process.env[k] = envSnapshot[k]; } });
function claude(spec = "claude-code", mode = "ok", extra = {}) {
  process.env.FAKE_CLAUDE_MODE = mode;
  for (const [k, v] of Object.entries(extra)) process.env[k] = v;
  return resolveAgent(spec, { command: CLAUDE_CMD });
}
function firstView() { const s = engine.step(engine.createGame({ players: P2, seed: 4 }), { type: "start_round" }).state; return observeGame(s, engine.pendingPlayer(s)); }
const oneMove = (a, timeoutMs = 5000) => decide(a, { gameView: firstView(), gameId: "t", timeoutMs, retry: false });
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function untilDead(pid, ms = 3000) { const end = Date.now() + ms; while (pidAlive(pid) && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); return !pidAlive(pid); }

test("claude-code: hello probes a real call, reports version and effective model, and fails clearly", async () => {
  const a = claude();
  const h = await a.hello();
  assert.equal(a.name, "claude-code:claude-fake-1");
  assert.equal(a.version, "9.9.9");
  assert.equal(h.protocol, "flip7-agent/1");
  await a.shutdown();

  const bad = claude("claude-code", "probe-error");
  await assert.rejects(bad.hello(), (err) => err instanceof AdapterError && /Not logged in/.test(err.message));

  process.env.FAKE_CLAUDE_MODE = "ok";
  const missing = resolveAgent("claude-code", { command: "flip7-definitely-not-installed-xyz" });
  await assert.rejects(missing.hello(), (err) => err instanceof AdapterError && /not found on PATH/.test(err.message));

  assert.throws(() => resolveAgent("claude-code:bad model!"), (err) => err instanceof AdapterError && /model/.test(err.message));
});

test("claude-code: move sends the rendered request on stdin, passes --model, strips CLAUDECODE, and plays a game", async () => {
  process.env.CLAUDECODE = "1";
  const a = claude("claude-code:sonnet");
  const out = await playOne(a, 5000);
  assert.ok(out.decisions.length > 5);
  const raw = JSON.parse(out.decisions[0].attempts[0].raw_response);
  assert.equal(raw.claudecode, null, "CLAUDECODE must not reach the child");
  assert.ok(raw.argv.includes("--model") && raw.argv[raw.argv.indexOf("--model") + 1] === "sonnet");
  assert.ok(raw.argv.includes("-p") && raw.argv.includes("--output-format") && raw.argv[raw.argv.indexOf("--tools") + 1] === "");
  assert.ok(raw.inputLength > 200, "the whole rendered request reached stdin before EOF");
  assert.equal(out.decisions[0].fallback_used, false);
});

test("claude-code: is_error, non-JSON, exit 1, early EOF, and oversize output are invalid replies; three in a row are fatal", async () => {
  for (const mode of ["error", "nonjson", "exit1", "eof-early", "huge"]) {
    const a = claude("claude-code", mode);
    if (mode === "eof-early") { await assert.rejects(a.hello(), AdapterError, "the probe fails when claude exits without answering"); process.env.FAKE_CLAUDE_MODE = "ok"; await a.hello(); process.env.FAKE_CLAUDE_MODE = mode; }
    else await a.hello();
    const d1 = await oneMove(a);
    assert.equal(d1.fallback_used, true, mode);
    assert.equal(d1.attempts[0].outcome, "invalid", mode);
    const d2 = await oneMove(a);
    assert.equal(d2.fallback_used, true, mode);
    await assert.rejects(oneMove(a), (err) => err instanceof AdapterError && /3 consecutive/.test(err.message), mode);
    await a.shutdown();
  }
});

test("claude-code: a good reply resets the consecutive-error counter", async () => {
  const counter = path.join(os.tmpdir(), `flip7-fake-claude-${process.pid}.txt`);
  try { fs.unlinkSync(counter); } catch { /* fresh */ }
  const a = claude("claude-code", "error-twice", { FAKE_CLAUDE_COUNTER: counter });
  await a.hello();
  const ds = [await oneMove(a), await oneMove(a), await oneMove(a), await oneMove(a)];
  assert.deepEqual(ds.map((d) => d.fallback_used), [true, true, false, false]);
  await a.shutdown();
});

test("claude-code: a slow reply is killed at the deadline (no orphan), shutdown kills live moves, and nothing runs after shutdown", async () => {
  const pidfile = path.join(os.tmpdir(), `flip7-fake-claude-pids-${process.pid}.txt`);
  try { fs.unlinkSync(pidfile); } catch { /* fresh */ }
  const a = claude("claude-code", "sleep", { FAKE_CLAUDE_PIDFILE: pidfile });
  process.env.FAKE_CLAUDE_MODE = "ok"; await a.hello(); process.env.FAKE_CLAUDE_MODE = "sleep";
  const d = await oneMove(a, 300);
  assert.equal(d.attempts[0].outcome, "timeout");
  assert.equal(d.fallback_used, true);
  const pids = () => fs.readFileSync(pidfile, "utf8").trim().split("\n").map(Number);
  assert.equal(await untilDead(pids()[0]), true, "the timed-out child must be killed");
  // A second move starts a fresh child; shutdown during it must return within ~2 s and kill it.
  const pending = oneMove(a, 10000);
  await new Promise((r) => setTimeout(r, 300));
  const started = Date.now();
  await a.shutdown();
  assert.ok(Date.now() - started < 3000, "shutdown must not wait for the 5 s sleeper");
  const d2 = await pending;
  assert.equal(d2.fallback_used, true, "the killed move falls back rather than hanging");
  assert.equal(await untilDead(pids()[1]), true, "the child live at shutdown must be killed");
  await assert.rejects(oneMove(a), (err) => err instanceof AdapterError && /shut down/.test(err.message), "no new process after shutdown");
});
