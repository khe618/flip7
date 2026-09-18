"use strict";
const rng = require("../lib/rng");

const RATIOS = {
  win_rate: ["wins", "games"],
  points_vs_table: ["pvt", "games"],
  mean_score_per_round: ["score", "rounds"],
  bust_rate: ["busts", "rounds"],
  flip7_rate: ["flip7s", "rounds"],
  mean_hits_per_round: ["hits", "rounds"],
  rounds_per_game: ["rounds", "games"],
  invalid_attempt_rate: ["invalid", "attempts"],
  decisions_with_fallback_rate: ["fallbacks", "decisions"],
  timeout_rate: ["timeouts", "decisions"],
};

function blockOf(records) {
  const b = { games: 0, wins: 0, pvt: 0, score: 0, rounds: 0, busts: 0, flip7s: 0, hits: 0, decisions: 0, attempts: 0, invalid: 0, timeouts: 0, fallbacks: 0 };
  for (const r of records) {
    b.games += 1; b.wins += r.won ? 1 : 0; b.pvt += r.points_vs_table; b.score += r.score; b.rounds += r.rounds;
    b.busts += r.busts; b.flip7s += r.flip7s; b.hits += r.hits; b.decisions += r.decisions; b.attempts += r.attempts;
    b.invalid += r.invalid; b.timeouts += r.timeouts; b.fallbacks += r.fallbacks;
  }
  return b;
}

function ratio(blocks, [num, den]) {
  let n = 0, d = 0;
  for (const b of blocks) { n += b[num]; d += b[den]; }
  return d === 0 ? 0 : n / d;
}

// Nearest-rank percentile: the smallest value with at least p of the sample at or below it.
function percentile(sorted, p) { return sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : 0; }

// Seed-block percentile bootstrap (spec §6.4). Games of one seed form one block.
function computeMetrics(records, { bootstrap = 2000, seed = 1 } = {}) {
  const byAgent = new Map();
  for (const r of records) { if (!byAgent.has(r.agent)) byAgent.set(r.agent, []); byAgent.get(r.agent).push(r); }
  const out = {};
  for (const [agent, recs] of byAgent) {
    const bySeed = new Map();
    for (const r of recs) { if (!bySeed.has(r.seed)) bySeed.set(r.seed, []); bySeed.get(r.seed).push(r); }
    const blocks = [...bySeed.values()].map(blockOf);
    const random = rng.createRandom(`${seed}:${agent}`);
    const samples = Object.fromEntries(Object.keys(RATIOS).map((k) => [k, []]));
    for (let b = 0; b < bootstrap; b++) {
      const pick = [];
      for (let i = 0; i < blocks.length; i++) pick.push(blocks[Math.floor(random() * blocks.length)]);
      for (const [k, def] of Object.entries(RATIOS)) samples[k].push(ratio(pick, def));
    }
    const m = { n_games: recs.length, n_seeds: blocks.length };
    for (const [k, def] of Object.entries(RATIOS)) {
      const sorted = samples[k].sort((a, b) => a - b);
      m[k] = { value: ratio(blocks, def), ci95: [percentile(sorted, 0.025), percentile(sorted, 0.975)] };
    }
    const lat = recs.flatMap((r) => r.latencies).sort((a, b) => a - b);
    m.latency_ms = { mean: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0, p50: percentile(lat, 0.5), p95: percentile(lat, 0.95) };
    out[agent] = m;
  }
  return out;
}

module.exports = { computeMetrics, RATIOS };
