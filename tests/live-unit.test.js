"use strict";
// Unit-level coverage for bench/live.js's lifecycle bookkeeping, with no real server: messages
// are fed through `_receive`, the exact handler a ws "message" takes, and outgoing messages are
// captured through the `_send` seam. The fixture agent counts start()/end() calls.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { driveLiveSeat, DriverError, exitCodeFor } = require("../bench/live");

const FIX = (f) => "file:" + path.join(__dirname, "fixtures", f);
const COUNTING = path.join(__dirname, "fixtures", "counting-agent.js");

function make(extra = {}) {
  const sent = [], events = [];
  // A refused local port: driveLiveSeat always calls connect(), but nothing here reaches the socket.
  const driver = driveLiveSeat({ url: "ws://127.0.0.1:1", room: "unit", spec: FIX("counting-agent.js"), name: "unit", onEvent: (e) => events.push(e), _send: (m) => { sent.push(m); return true; }, ...extra });
  driver.done.catch(() => {});      // rejections are asserted explicitly where expected
  return { driver, sent, events };
}
const joined = { type: "joined", playerId: "p1", resumeToken: "tok" };
const lobby = { type: "state", room: "unit", phase: "lobby", you: null, playerCount: 1, maxPlayers: 6 };
const joins = (sent) => sent.filter((m) => m.type === "join").length;
function playingState(turnNumber, you = "p1", round = 1) {
  return { type: "state", room: "unit", phase: "playing", you, game: { round, turnNumber, decision: null, current_player: null, players: [{ id: "p1", name: "you", seat: 0, score: 0 }, { id: "p2", name: "bot", seat: 1, score: 0 }] }, timer: null };
}
function decisionState(turnNumber, remainingMs = 2000) {
  const s = playingState(turnNumber);
  s.game.decision = { type: "hit_or_stay" }; s.game.legal_actions = ["hit", "stay"]; s.game.current_player = "p1"; s.timer = { remainingMs };
  Object.assign(s.game, { you: "p1", target_score: 200, dealer: "p1", deck_remaining: 80, discard: [], resolution: [], history: [], history_start: 0 });
  for (const p of s.game.players) Object.assign(p, { status: "active", numbers: [], modifiers: [], second_chance: false, round_score: 0, unique_count: 0 });
  return s;
}
function gameOverState(you = "p1") {
  return { type: "state", room: "unit", phase: "game_over", you, results: { winner: "p1", winnerName: "you", standings: [{ id: "p1", name: "you", score: 210 }, { id: "p2", name: "bot", score: 120 }] }, game: { round: 3, turnNumber: 40, decision: null, current_player: null, winner: "p1", players: [{ id: "p1", name: "you", seat: 0, score: 210 }, { id: "p2", name: "bot", seat: 1, score: 120 }] }, timer: null };
}
const tick = () => new Promise((r) => setImmediate(r));

test("start() fires once per game across several round-1 playing states, end() once on game_over, done resolves", async () => {
  const { driver, events } = make();
  const { calls } = require(COUNTING);
  const before = { start: calls.start, end: calls.end };
  driver._receive(joined);
  await driver._receive(playingState(1));
  await driver._receive(playingState(2));
  await driver._receive(playingState(3));
  assert.equal(calls.start - before.start, 1, "start() must fire once, not once per turn");
  assert.equal(calls.end - before.end, 0);
  await driver._receive(gameOverState());
  assert.equal(calls.end - before.end, 1);
  const res = await driver.done;
  assert.equal(res.phase, "game_over");
  assert.equal(events.at(-1).type, "game_over");
  assert.equal(events.at(-1).standings[0].name, "you");
  await driver.close();
});

test("an unseated visitor ignores playing and game_over, then joins exactly once at the next lobby after game_in_progress", async () => {
  const { driver, sent, events } = make();
  const { calls } = require(COUNTING);
  const before = { start: calls.start, end: calls.end };
  driver._receive({ type: "error", code: "game_in_progress", message: "Game in progress." });
  assert.equal(events.at(-1).type, "waiting");
  await driver._receive(playingState(5, null));
  await driver._receive(gameOverState(null));
  assert.equal(calls.start - before.start, 0, "visitors never start a game");
  assert.equal(calls.end - before.end, 0);
  let settled = false; driver.done.then(() => { settled = true; }, () => { settled = true; });
  await tick();
  assert.equal(settled, false, "a visitor's game_over does not end the run");
  await driver._receive(lobby);
  await driver._receive(lobby);
  assert.equal(joins(sent), 1, "one join per lobby, never a loop");
  assert.equal(sent[0].agent, true);
  assert.equal(sent[0].name, "unit");
  await driver.close();
});

test("unknown_token clears identity and requests a fresh seat; a state with you:null drops the seat", async () => {
  const { driver, sent } = make();
  driver._receive(joined);
  assert.equal(driver._token(), "tok");
  driver._receive({ type: "error", code: "unknown_token", message: "Unknown session." });
  assert.equal(driver._token(), null);
  assert.equal(joins(sent), 1);
  driver._receive({ type: "joined", playerId: "p4", resumeToken: "tok2" });
  await driver._receive({ ...lobby, you: null });
  await driver._receive(lobby);
  assert.equal(joins(sent), 2, "losing the seat re-joins once at the next lobby");
  await driver.close();
});

test("a visitor state during an in-flight resume is not a lost seat and triggers no join", async () => {
  const { driver, sent } = make();
  driver._receive(joined);
  driver._sendResume();                       // what the open handler does on reconnect with a token
  assert.equal(sent.at(-1).type, "resume");
  await driver._receive({ ...lobby, you: null });   // the server's immediate visitor snapshot
  await driver._receive(lobby);
  assert.equal(joins(sent), 0, "no join while resume is pending");
  assert.equal(driver._token(), "tok");
  driver._receive({ type: "joined", playerId: "p1", resumeToken: "tok" });   // resume accepted
  // Once resumed, the driver is seated: the server always sends a seated player you: <own id>
  // (lib/snapshot.js buildState), never you: null, so a normal post-resume lobby broadcast looks
  // like this, not like the visitor snapshot `lobby` used above.
  await driver._receive({ ...lobby, you: "p1" });
  assert.equal(joins(sent), 0);
  await driver.close();
});

test("room_full and seat takeover reject done with typed codes; exitCodeFor maps them", async () => {
  const a = make();
  a.driver._receive({ type: "error", code: "room_full", message: "Room is full." });
  await assert.rejects(a.driver.done, (err) => err instanceof DriverError && err.code === "room_full");
  await a.driver.close();
  assert.equal(exitCodeFor(new DriverError("room_full", "x")), 4);
  assert.equal(exitCodeFor(new DriverError("seat_taken_over", "x")), 3);
  assert.equal(exitCodeFor(new DriverError("adapter", "x")), 2);
  assert.equal(exitCodeFor(new Error("anything else")), 2);
});

test("an AdapterError during a decision rejects done with code adapter", async () => {
  const { driver } = make({ spec: FIX("agent-throws.js") });
  driver._receive(joined);
  await driver._receive(decisionState(1));
  await assert.rejects(driver.done, (err) => err instanceof DriverError && err.code === "adapter");
  await driver.close();
});

test("a timed-out decision is a fallback decision event and the act is still sent", async () => {
  const { driver, sent, events } = make({ spec: FIX("agent-hangs.js") });
  driver._receive(joined);
  await driver._receive(decisionState(1, 260));     // timeoutMs = 10
  const d = events.find((e) => e.type === "decision");
  assert.ok(d, "a decision event is emitted");
  assert.equal(d.turnNumber, 1);
  assert.equal(d.fallback, "timeout");
  assert.equal(d.action, "stay");
  assert.equal(sent.filter((m) => m.type === "act").length, 1);
  await driver.close();
});

test("an action is not marked acted when the socket could not send it, and is not sent for a superseded turn", async () => {
  // _send returning false models a closed socket.
  const dropped = [];
  const a = make({ spec: "bot:threshold25", _send: (m) => { dropped.push(m); return false; } });
  a.driver._receive(joined);
  await a.driver._receive(decisionState(7));
  assert.equal(a.driver.stats.acts, 0, "nothing was delivered");
  await a.driver.close();

  // A newer state for turn 9 arrives while turn 8 is being decided: turn 8's act must not go out.
  const b = make({ spec: FIX("agent-hangs.js") });
  b.driver._receive(joined);
  const p = b.driver._receive(decisionState(8, 400));   // decide() will time out after 150 ms
  await tick();
  b.driver._receive({ ...decisionState(9), game: { ...decisionState(9).game, current_player: "p2" } });
  await p;
  assert.deepEqual(b.sent.filter((m) => m.type === "act").map((m) => m.turnNumber), [], "turn 8 was superseded");
  assert.equal(b.driver.stats.lateSkips, 1);
  await b.driver.close();
});

test("close() stops processing: no decision and no send after close", async () => {
  const { driver, sent } = make({ spec: "bot:threshold25" });
  driver._receive(joined);
  await driver.close();
  await driver._receive(decisionState(3));
  assert.equal(sent.filter((m) => m.type === "act").length, 0);
  assert.equal(driver.stats.decisions, 0);
});

test("a blocked join never latches joinInFlight: the next lobby state retries once sending works again", async () => {
  // _send consults a mutable flag so the same message can be "blocked" (socket gone) and then
  // "delivered" (socket back) without a real socket.
  let allowSend = false;
  const sent = [];
  const { driver } = make({ _send: (m) => { if (!allowSend) return false; sent.push(m); return true; } });
  driver._receive({ type: "error", code: "game_in_progress", message: "Game in progress." });
  await driver._receive(lobby);   // requestSeat() runs but send() is blocked: joinInFlight must not latch
  assert.equal(joins(sent), 0, "the blocked join never reached the wire");
  allowSend = true;
  await driver._receive(lobby);   // joinInFlight was never stuck true, so this lobby state retries
  assert.equal(joins(sent), 1, "exactly one join once sending is possible again");
  await driver.close();
});
