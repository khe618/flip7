"use strict";
// Regenerates bench/fixtures/calibration.json: bot-only lineup over 200 standard seeds
// (regression reference) and over the smoke suite (asserted exactly by tests/bots.test.js).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runBenchmark } = require("./run");

const LINEUP = ["bot:threshold25", "bot:bustRisk25", "bot:evOneStep", "bot:adaptive"];

function pick(summary) {
  const out = {};
  for (const [key, m] of Object.entries(summary.agents)) out[key] = { mean_score_per_round: m.mean_score_per_round.value, bust_rate: m.bust_rate.value, win_rate: m.win_rate.value };
  return out;
}

async function main() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "flip7-cal-"));
  const smoke = await runBenchmark({ agents: LINEUP, suite: "smoke", out, quiet: true });
  const standard = await runBenchmark({ agents: LINEUP, suite: "standard", seeds: 200, out, quiet: true });
  const fixture = { generated_at: new Date().toISOString(), lineup: LINEUP, smoke: pick(smoke.summary), standard200: pick(standard.summary) };
  fs.mkdirSync(path.join(__dirname, "fixtures"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "fixtures", "calibration.json"), JSON.stringify(fixture, null, 2) + "\n");
  console.log(JSON.stringify(fixture, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { LINEUP, pick };
