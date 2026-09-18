"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { TrueSkill, Rating } = require("ts-trueskill");
const { BOT_NAMES } = require("../lib/bots");

const ENV = { mu: 25, sigma: 25 / 3, beta: 25 / 6, tau: 25 / 300, drawProbability: 0.02 };

function readRun(dir) {
  const file = path.join(dir, "games.jsonl");
  const recs = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const header = recs.find((r) => r.kind === "run") || { started_at: "" };
  const starts = new Map();
  const games = [];
  for (const r of recs) {
    if (r.kind === "game_start") starts.set(r.game_id, r);
    if (r.kind === "game_end" && starts.has(r.game_id)) {
      const s = starts.get(r.game_id);
      games.push({ game_id: r.game_id, started_at: header.started_at || "", order: games.length, seats: s.seats.map((p) => ({ key: p.agent, name: p.name, score: r.final_scores[p.id] })) });
    }
  }
  return games;
}

function rateRuns(dirs) {
  const env = new TrueSkill(ENV.mu, ENV.sigma, ENV.beta, ENV.tau, ENV.drawProbability);
  const seen = new Set();
  const all = [];
  for (const d of dirs) for (const g of readRun(d)) { if (seen.has(g.game_id)) continue; seen.add(g.game_id); all.push(g); }
  all.sort((a, b) => (a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : a.order - b.order));
  const ratings = new Map();
  const edges = new Map();
  const warnings = [];
  let rated = 0, skipped = 0;
  const get = (key, name) => { if (!ratings.has(key)) ratings.set(key, { name, version: key.slice(key.lastIndexOf("@") + 1), rating: new Rating(), games: 0 }); return ratings.get(key); };
  for (const g of all) {
    const keys = g.seats.map((s) => s.key);
    if (new Set(keys).size !== keys.length) { skipped++; continue; }   // same agent twice: ambiguous, skip
    const entries = g.seats.map((s) => get(s.key, s.name));
    const ranks = g.seats.map((s) => g.seats.filter((o) => o.score > s.score).length);
    const updated = env.rate(entries.map((e) => [e.rating]), ranks);
    entries.forEach((e, i) => { e.rating = updated[i][0]; e.games += 1; });
    for (const k of keys) { if (!edges.has(k)) edges.set(k, new Set()); for (const o of keys) if (o !== k) edges.get(k).add(o); }
    rated++;
  }
  // connectivity to at least one baseline bot
  const baselines = new Set([...ratings.keys()].filter((k) => BOT_NAMES.includes(k.slice(0, k.lastIndexOf("@")))));
  const reach = new Set(baselines);
  const queue = [...baselines];
  while (queue.length) { const k = queue.pop(); for (const o of edges.get(k) || []) if (!reach.has(o)) { reach.add(o); queue.push(o); } }
  for (const k of ratings.keys()) if (!reach.has(k)) warnings.push(`${k} is not connected to any baseline bot through played games; its rating is not comparable`);
  const out = {};
  for (const [key, e] of [...ratings.entries()].sort((a, b) => (b[1].rating.mu - 3 * b[1].rating.sigma) - (a[1].rating.mu - 3 * a[1].rating.sigma))) {
    out[key] = { name: e.name, version: e.version, mu: e.rating.mu, sigma: e.rating.sigma, conservative: e.rating.mu - 3 * e.rating.sigma, games: e.games };
  }
  return { ratings: out, warnings, games_rated: rated, games_skipped: skipped };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  // `--out` as the last argument has no value: splice returns ["--out"] and the file name is undefined.
  const outFile = (outIdx >= 0 ? args.splice(outIdx, 2)[1] : null) || "ratings.json";
  if (!args.length) { console.error("usage: node bench/rate.js <results-dir>... [--out ratings.json]"); process.exit(1); }
  const res = rateRuns(args);
  console.log("name                 version   mu      sigma   conservative  games");
  for (const [key, r] of Object.entries(res.ratings)) console.log(`${r.name.padEnd(20)} ${r.version.padEnd(9)} ${r.mu.toFixed(2).padStart(6)}  ${r.sigma.toFixed(2).padStart(6)}  ${r.conservative.toFixed(2).padStart(12)}  ${String(r.games).padStart(5)}`);
  for (const w of res.warnings) console.warn(`warning: ${w}`);
  console.log(`${res.games_rated} games rated, ${res.games_skipped} skipped (duplicate agent in a game)`);
  fs.writeFileSync(outFile, JSON.stringify(res, null, 2));
}

module.exports = { rateRuns, ENV };
