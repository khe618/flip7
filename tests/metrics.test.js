"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { computeMetrics } = require("../bench/metrics");

function rec(seed, rotation, agent, over) {
  return { seed, rotation, seat: rotation, agent, score: 200, won: true, points_vs_table: 50, rounds: 10, busts: 3, flip7s: 1, hits: 30, decisions: 40, attempts: 41, invalid: 1, timeouts: 0, fallbacks: 0, latencies: [1, 2, 3, 100], ...over };
}

test("metrics are ratios of sums with seed-block bootstrap intervals", () => {
  const records = [];
  for (let seed = 0; seed < 5; seed++) for (let r = 0; r < 4; r++) records.push(rec(seed, r, "a@1", { won: seed % 2 === 0, points_vs_table: seed % 2 ? 10 : -10 }));
  const m = computeMetrics(records, { bootstrap: 200, seed: 1 })["a@1"];
  assert.equal(m.n_games, 20);
  assert.equal(m.n_seeds, 5);
  assert.equal(m.win_rate.value, 0.6);
  assert.equal(m.mean_score_per_round.value, 20);
  assert.equal(m.bust_rate.value, 0.3);
  assert.equal(m.flip7_rate.value, 0.1);
  assert.equal(m.mean_hits_per_round.value, 3);
  assert.equal(m.rounds_per_game.value, 10);
  assert.ok(Math.abs(m.invalid_attempt_rate.value - 1 / 41) < 1e-12);
  assert.equal(m.decisions_with_fallback_rate.value, 0);
  assert.equal(m.timeout_rate.value, 0);
  assert.equal(m.points_vs_table.value, -2);
  assert.ok(m.points_vs_table.ci95[0] <= -2 && m.points_vs_table.ci95[1] >= -2);
  assert.ok(m.points_vs_table.ci95[0] < m.points_vs_table.ci95[1]);
  assert.deepEqual(m.latency_ms, { mean: 26.5, p50: 2, p95: 100 });
  assert.deepEqual(computeMetrics(records, { bootstrap: 200, seed: 1 }), computeMetrics(records, { bootstrap: 200, seed: 1 }), "bootstrap is seeded");
  assert.ok(m.win_rate.ci95[0] < 0.6 && m.win_rate.ci95[1] > 0.6, "wins vary by seed block, so the interval is wide");
});

test("a constant metric has a degenerate interval and one seed still works", () => {
  const m = computeMetrics([rec(1, 0, "b@1"), rec(1, 1, "b@1")], { bootstrap: 50, seed: 2 })["b@1"];
  assert.deepEqual(m.win_rate.ci95, [1, 1]);
  assert.equal(m.n_seeds, 1);
});
