"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../lib/engine");
const { observeGame } = require("../lib/view");
const { makeRequest } = require("../lib/request");
const rng = require("../lib/rng");
const bots = require("../lib/bots");
const { deckFrom } = require("./helpers/deck");

const P4 = ["p1", "p2", "p3", "p4"].map((id) => ({ id, name: id }));

function req(state, id) { return makeRequest(observeGame(state, id), { gameId: "g", timeoutMs: 1000, requestId: "r" }); }

test("every bot returns a legal action across 1000 random decisions", () => {
  const random = rng.createRandom(123);
  const agents = bots.BOT_NAMES.map((n) => bots.createBot(n, { random: rng.createRandom(n) }));
  let seen = 0;
  let r = engine.step(engine.createGame({ players: P4, seed: 77 }), { type: "start_round" });
  while (seen < 1000) {
    if (r.state.phase === "game_over") r = engine.step(engine.createGame({ players: P4, seed: seen }), { type: "start_round" });
    if (r.state.phase === "round_over") { r = engine.step(r.state, { type: "start_round" }); continue; }
    const id = engine.pendingPlayer(r.state);
    const legal = engine.legalActions(r.state);
    for (const a of agents) {
      const action = a.act(req(r.state, id));
      assert.ok(legal.includes(action), `${a.name} returned ${action}, legal ${legal}`);
      assert.equal(a.version, "1");
    }
    seen++;
    r = engine.step(r.state, { type: "act", player: id, action: legal[Math.floor(random() * legal.length)] });
  }
});

test("bustRisk counts unseen copies of held numbers over unseen cards", () => {
  const r = engine.step(engine.createGame({ players: P4, seed: 1, deck: deckFrom([7, 1, 2, 3]) }), { type: "start_round" });
  const v = observeGame(r.state, "p2");
  const me = v.players.find((p) => p.id === "p2");
  // p2 holds 7; six 7s remain among 90 unseen cards
  assert.ok(Math.abs(bots.bustRisk(v, me) - 6 / 90) < 1e-12);
  const withSc = { ...me, second_chance: true };
  assert.equal(bots.bustRisk(v, withSc), 0);
});

test("threshold25 hits below 25 and stays at 25 or more", () => {
  const first = engine.step(engine.createGame({ players: P4, seed: 1, deck: deckFrom([12, 1, 2, 3]) }), { type: "start_round" });
  // p2 holds a 12: round_score 12 < 25 -> hit
  assert.equal(bots.POLICIES.threshold25(req(first.state, "p2"), () => 0.5), "hit");
  const r2 = engine.step(engine.createGame({ players: P4, seed: 1, deck: deckFrom([12, 1, 2, 3, "x2", "+2"]) }), { type: "start_round" });
  let s = r2.state;
  s = engine.step(s, { type: "act", player: "p2", action: "hit" }).state; // x2 -> 24
  for (const p of ["p3", "p4", "p1"]) s = engine.step(s, { type: "act", player: p, action: "stay" }).state;
  assert.equal(bots.POLICIES.threshold25(req(s, "p2"), () => 0.5), "hit");
  s = engine.step(s, { type: "act", player: "p2", action: "hit" }).state; // +2 -> 26
  assert.equal(bots.POLICIES.threshold25(req(s, "p2"), () => 0.5), "stay");
});

test("chooseTarget follows the targeting rule", () => {
  const base = {
    decision: { type: "choose_target", card: "freeze", candidates: ["p1", "p2", "p3"] },
    you: "p2",
    players: [
      { id: "p1", score: 50, round_score: 10, unique_count: 2, status: "active" },
      { id: "p2", score: 40, round_score: 5, unique_count: 1, status: "active" },
      { id: "p3", score: 30, round_score: 40, unique_count: 5, status: "active" },
    ],
  };
  assert.equal(bots.chooseTarget(base), "target:p3", "freeze the highest score+round_score other than self");
  assert.equal(bots.chooseTarget({ ...base, decision: { type: "choose_target", card: "freeze", candidates: ["p2"] } }), "target:p2");
  assert.equal(bots.chooseTarget({ ...base, decision: { type: "choose_target", card: "flip_three", candidates: ["p1", "p2", "p3"] } }), "target:p2", "self when unique_count <= 2");
  const me5 = { ...base, players: base.players.map((p) => (p.id === "p2" ? { ...p, unique_count: 5 } : p)) };
  assert.equal(bots.chooseTarget({ ...me5, decision: { type: "choose_target", card: "flip_three", candidates: ["p1", "p2", "p3"] } }), "target:p3");
  assert.equal(bots.chooseTarget({ ...base, decision: { type: "choose_target", card: "second_chance", candidates: ["p1", "p3"] } }), "target:p3", "lowest score");
});

test("adaptive stays when banking now reaches the target while leading", () => {
  const v = {
    decision: { type: "hit_or_stay" }, legal_actions: ["hit", "stay"], you: "p2", target_score: 200,
    players: [
      { id: "p1", score: 150, round_score: 0, numbers: [], modifiers: [], second_chance: false, unique_count: 0, status: "stayed" },
      { id: "p2", score: 190, round_score: 12, numbers: [12], modifiers: [], second_chance: false, unique_count: 1, status: "active" },
    ],
    discard: [], deck_remaining: 92,
  };
  assert.equal(bots.POLICIES.adaptive(makeRequest(v, { gameId: "g", timeoutMs: 1, requestId: "r" }), () => 0.5), "stay");
});

test("smoke-suite calibration matches the committed fixture exactly (regression, not a correctness proof)", async () => {
  const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path");
  const { runBenchmark } = require("../bench/run");
  const { LINEUP, pick } = require("../bench/calibrate");
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "bench", "fixtures", "calibration.json"), "utf8"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "flip7-cal-test-"));
  const { summary } = await runBenchmark({ agents: LINEUP, suite: "smoke", out, quiet: true });
  assert.deepEqual(pick(summary), fixture.smoke, "run `npm run calibrate` after an intended rules or policy change");
});
