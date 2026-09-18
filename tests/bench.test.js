"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { getSuite } = require("../bench/suite");
const { runBenchmark } = require("../bench/run");
const { verifyReplay } = require("../bench/replay");
const rng = require("../lib/rng");

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "flip7-bench-")); }
function lines(file) { return fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)); }

test("suites are deterministic and rotations equal the table size", () => {
  const s = getSuite("standard");
  assert.equal(s.table, 4); assert.equal(s.seeds.length, 50); assert.equal(s.rotations, 4);
  assert.equal(s.seeds[0], rng.fnv1a("standard:0"));
  assert.deepEqual(getSuite("smoke").seeds, [0, 1, 2].map((i) => rng.fnv1a("smoke:" + i)));
  assert.equal(getSuite("standard", { seeds: 7, table: 3 }).seeds.length, 7);
  assert.equal(getSuite("standard", { seeds: 7, table: 3 }).rotations, 3);
  const f1 = getSuite("fresh", { seedBase: "x" }); const f2 = getSuite("fresh", { seedBase: "x" });
  assert.deepEqual(f1.seeds, f2.seeds);
  assert.notDeepEqual(f1.seeds, getSuite("fresh", { seedBase: "y" }).seeds);
  assert.throws(() => getSuite("nope"));
});

test("a smoke run writes games.jsonl and summary.json in the documented shape, and replays byte-equal", async () => {
  const out = tmp();
  // evOneStep is not in the default opponent lineup, so its name@version key is unique at the table
  const { dir, summary, runId } = await runBenchmark({ agent: "bot:evOneStep", suite: "smoke", out, timeoutMs: 1000, quiet: true });
  assert.ok(dir.startsWith(out));
  const recs = lines(path.join(dir, "games.jsonl"));
  assert.equal(recs[0].kind, "run");
  assert.equal(recs[0].run_id, runId);
  assert.equal(recs[0].suite, "smoke");
  assert.equal(recs[0].seeds.length, 3);
  assert.deepEqual(recs[0].agents.map((a) => a.spec), ["bot:evOneStep", "bot:threshold25", "bot:bustRisk25", "bot:adaptive"]);
  assert.equal(recs[recs.length - 1].kind, "summary");
  const starts = recs.filter((r) => r.kind === "game_start");
  const ends = recs.filter((r) => r.kind === "game_end");
  assert.equal(starts.length, 12); assert.equal(ends.length, 12);
  assert.deepEqual(new Set(starts.map((s) => s.rotation)), new Set([0, 1, 2, 3]));
  // rotation r seats the agent under test at seat r
  for (const s of starts) assert.equal(s.seats[s.rotation].spec, "bot:evOneStep");
  for (const s of starts) assert.ok(!/\d{6,}/.test(s.game_id) && s.game_id.length >= 6, "opaque game ids");
  // record order within a game: start, decisions, end
  let i = 1;
  while (recs[i].kind !== "summary") {
    assert.equal(recs[i].kind, "game_start");
    const id = recs[i].game_id; i++;
    let n = 0;
    while (recs[i].kind === "decision") { assert.equal(recs[i].game_id, id); assert.ok(recs[i].attempts.length >= 1); n++; i++; }
    assert.ok(n > 0);
    assert.equal(recs[i].kind, "game_end"); assert.equal(recs[i].game_id, id);
    assert.ok(Array.isArray(recs[i].events) && recs[i].events.length > 0);
    i++;
  }
  const sum = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.deepEqual(sum, summary);
  assert.equal(sum.n_games, 12); assert.equal(sum.n_seeds, 3); assert.equal(sum.aborted, false);
  assert.equal(sum.agent_under_test, "evOneStep@1");
  const m = sum.agents["evOneStep@1"];
  for (const k of ["win_rate", "points_vs_table", "mean_score_per_round", "bust_rate", "flip7_rate", "mean_hits_per_round", "rounds_per_game", "invalid_attempt_rate", "decisions_with_fallback_rate", "timeout_rate"]) {
    assert.ok(typeof m[k].value === "number" && Array.isArray(m[k].ci95), k);
  }
  assert.ok(m.latency_ms.p95 >= 0);
  assert.ok(sum.agents["bustRisk25@1"] && sum.agents["adaptive@1"]);
  const rep = verifyReplay(path.join(dir, "games.jsonl"));
  assert.equal(rep.games, 12);
  assert.deepEqual(rep.failures, []);
});

test("--agents seats every named agent and rotates them; a tampered log fails replay", async () => {
  const out = tmp();
  const { dir } = await runBenchmark({ agents: ["bot:threshold25", "bot:random", "bot:bustRisk25", "bot:adaptive"], suite: "smoke", seeds: 1, out, quiet: true });
  const recs = lines(path.join(dir, "games.jsonl"));
  const starts = recs.filter((r) => r.kind === "game_start");
  assert.equal(starts.length, 4);
  assert.deepEqual(starts.map((s) => s.seats[0].spec), ["bot:threshold25", "bot:adaptive", "bot:bustRisk25", "bot:random"]);
  const sum = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(sum.agent_under_test, null);
  const file = path.join(dir, "games.jsonl");
  const tampered = fs.readFileSync(file, "utf8").replace(/"action":"hit"/, '"action":"stay"');
  fs.writeFileSync(file, tampered);
  const rep = verifyReplay(file);
  assert.ok(rep.failures.length >= 1);
});

test("an AdapterError mid-run aborts the benchmark with aborted:true and partial results kept", async () => {
  const out = tmp();
  const fixture = path.join(__dirname, "fixtures", "agent-abort.js");
  const { dir, summary } = await runBenchmark({ agent: "file:" + fixture, suite: "smoke", seeds: 1, out, quiet: true });
  assert.equal(summary.aborted, true);
  assert.match(summary.abort_message, /start failed/);
  assert.match(summary.abort_message, /boom on second game/);
  assert.equal(summary.n_games, 1);
  assert.ok(summary.agents["abort@t"]);
  assert.equal(summary.agents["abort@t"].n_games, 1);
  // the non-AdapterError abort path writes only { kind: "summary", aborted: true } with no metrics;
  // this run must take the AdapterError path, which keeps the full metrics-bearing summary.
  assert.ok(summary.agents && Object.keys(summary.agents).length > 0);
  const recs = lines(path.join(dir, "games.jsonl"));
  const starts = recs.filter((r) => r.kind === "game_start");
  const ends = recs.filter((r) => r.kind === "game_end");
  assert.equal(starts.length, 1);
  assert.equal(ends.length, 1);
  assert.equal(recs[recs.length - 1].kind, "summary");
  assert.equal(recs[recs.length - 1].aborted, true);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.deepEqual(onDisk, summary);
});
