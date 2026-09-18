"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runBenchmark } = require("../bench/run");
const { rateRuns } = require("../bench/rate");

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "flip7-rate-")); }

test("threshold25 rates above random; duplicate runs are deduplicated; disconnected agents warn", async () => {
  const out = tmp();
  const a = await runBenchmark({ agents: ["bot:threshold25", "bot:random", "bot:bustRisk25", "bot:adaptive"], suite: "smoke", out, quiet: true });
  const b = await runBenchmark({ agents: ["bot:threshold25", "bot:random", "bot:bustRisk25", "bot:adaptive"], suite: "smoke", seedBase: "b", out, quiet: true });
  const once = rateRuns([a.dir, b.dir]);
  assert.ok(once.ratings["threshold25@1"].mu > once.ratings["random@1"].mu);
  assert.equal(once.ratings["random@1"].games, 24);
  assert.equal(once.games_rated, 24);
  const twice = rateRuns([a.dir, b.dir, a.dir]);
  assert.equal(twice.games_rated, 24);
  assert.deepEqual(twice.ratings, once.ratings);
  for (const r of Object.values(once.ratings)) {
    assert.ok(Math.abs(r.conservative - (r.mu - 3 * r.sigma)) < 1e-9);
  }
  // an island of agents never seated with a baseline
  const island = tmp();
  const dir = path.join(island, "run-x"); fs.mkdirSync(dir);
  const recs = [
    { kind: "run", run_id: "x", agents: [] },
    { kind: "game_start", game_id: "g1", seats: [{ id: "p1", name: "alpha", seat: 0, agent: "alpha@1" }, { id: "p2", name: "beta", seat: 1, agent: "beta@1" }] },
    { kind: "game_end", game_id: "g1", final_scores: { p1: 200, p2: 100 }, winner: "p1", rounds: 5, events: [] },
    { kind: "summary" },
  ];
  fs.writeFileSync(path.join(dir, "games.jsonl"), recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const res = rateRuns([a.dir, dir]);
  assert.ok(res.warnings.some((w) => /alpha@1/.test(w) && /baseline/.test(w)));
  assert.ok(res.ratings["alpha@1"].mu > res.ratings["beta@1"].mu);
});
