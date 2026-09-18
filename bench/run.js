"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const engine = require("../lib/engine");
const { observeGame } = require("../lib/view");
const { PROTOCOL } = require("../lib/request");
const rng = require("../lib/rng");
const { resolveAgent, AdapterError } = require("../agents/adapter");
const { decide } = require("../agents/decide");
const { getSuite, SUITE_NAMES } = require("./suite");
const { computeMetrics } = require("./metrics");

const DEFAULT_OPPONENTS = ["threshold25", "bustRisk25", "adaptive"];
const MAX_DECISIONS_PER_GAME = 20000;

function opaqueId(bytes = 4) { return crypto.randomBytes(bytes).toString("hex").replace(/\d/g, (d) => "ghjkmnpqrs"[d]); }
function keyOf(a) { return `${a.name}@${a.version}`; }

function seatSpecs({ agent, agents, opponents, table }) {
  if (agents && agents.length) {
    if (agents.length > table) throw new Error(`--agents lists ${agents.length} agents but the table has ${table} seats`);
    const specs = agents.slice();
    for (let i = 0; specs.length < table; i++) specs.push("bot:" + opponents[i % opponents.length]);
    return specs;
  }
  if (!agent) throw new Error("pass --agent <spec> or --agents <spec,...>");
  const specs = [agent];
  for (let i = 0; specs.length < table; i++) specs.push("bot:" + opponents[i % opponents.length]);
  return specs;
}

async function runBenchmark(options) {
  const opts = { suite: "standard", opponents: DEFAULT_OPPONENTS, timeoutMs: 30000, out: "bench/results", quiet: false, ...options };
  const suite = getSuite(opts.suite, { seeds: opts.seeds, table: opts.table, seedBase: opts.seedBase });
  const specs = seatSpecs({ agent: opts.agent, agents: opts.agents, opponents: opts.opponents, table: suite.table });
  const runId = opts.runId || `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${opaqueId(2)}`;
  const dir = path.join(opts.out, runId);
  fs.mkdirSync(dir, { recursive: true });
  const outFile = path.join(dir, "games.jsonl");
  const stream = fs.createWriteStream(outFile);
  const write = (obj) => stream.write(JSON.stringify(obj) + "\n");
  const log = (...a) => { if (!opts.quiet) console.log(...a); };

  // External adapters live for the whole run; bot adapters are recreated per game with a deterministic RNG.
  // Everything from the first hello onward runs inside one guarded lifecycle so a failure still
  // shuts adapters down and leaves an `aborted` summary behind.
  const external = specs.map((spec) => (spec.startsWith("bot:") ? null : resolveAgent(spec)));
  let specNames = [];
  const records = [];
  // Seeds are the one thing an agent must not read while the run is in flight: every rotation of a
  // seed replays the same initial shuffle, so a seed (or the base it was derived from) turns later
  // rotations into a known card path. `games.jsonl` is the agent-readable log; the seeds, the seed
  // base and each game's rotation go to `run-private.json`, which only the runner and replay read.
  const privateGames = {};
  const writePrivate = () => fs.writeFileSync(path.join(dir, "run-private.json"), JSON.stringify({ run_id: runId, suite: suite.name, seed_base: suite.seed_base, seeds: suite.seeds, games: privateGames }, null, 2) + "\n");
  let aborted = false, abortMessage = null, gamesPlayed = 0;

  // Count busts and Flip 7s from every engine step, including deals and round starts.
  function account(stats, events) {
    for (const e of events) {
      if (e.type === "bust") stats[Number(e.player.slice(1)) - 1].busts += 1;
      if (e.type === "flip7") stats[Number(e.player.slice(1)) - 1].flip7s += 1;
    }
  }

  try {
    for (const a of external) if (a) await a.hello();
    specNames = specs.map((spec, i) => (external[i] ? external[i] : resolveAgent(spec)));
    for (let i = 0; i < specNames.length; i++) if (!external[i]) await specNames[i].hello();
    const agentsMeta = specs.map((spec, i) => ({ name: specNames[i].name, version: specNames[i].version, spec }));
    write({ kind: "run", run_id: runId, protocol: PROTOCOL, suite: suite.name, table: suite.table, agents: agentsMeta, started_at: new Date().toISOString() });

    for (const seed of suite.seeds) {
      for (let rotation = 0; rotation < suite.rotations; rotation++) {
        // seat s holds spec index (s - rotation) mod table, so spec 0 sits at seat `rotation`
        const seatAdapters = [];
        for (let s = 0; s < suite.table; s++) {
          const idx = (s - rotation + suite.table) % suite.table;
          const spec = specs[idx];
          const adapter = external[idx] || resolveAgent(spec, { random: rng.createRandom(`${seed}:${rotation}:${s}:${spec}`) });
          if (!external[idx]) await adapter.hello();
          seatAdapters.push({ adapter, spec, idx });
        }
        const gameId = opaqueId(4);
        const players = seatAdapters.map((sa, s) => ({ id: `p${s + 1}`, name: sa.adapter.name, seat: s, agent: keyOf(sa.adapter), spec: sa.spec }));
        // Notify every seat before logging game_start: if a seat's start() hook throws (adapter died),
        // the game never really began and the log should have no trace of it — not a dangling
        // game_start with no matching game_end.
        for (const p of players) await seatAdapters[p.seat].adapter.start({ type: "start", protocol: PROTOCOL, game_id: gameId, you: p.id, players: players.map((q) => ({ id: q.id, name: q.name, seat: q.seat })) });
        privateGames[gameId] = { seed, rotation };
        write({ kind: "game_start", game_id: gameId, seats: players });
        const stats = players.map(() => ({ busts: 0, flip7s: 0, hits: 0, decisions: 0, attempts: 0, invalid: 0, timeouts: 0, fallbacks: 0, latencies: [] }));
        let r = engine.step(engine.createGame({ players: players.map((p) => ({ id: p.id, name: p.name })), seed }), { type: "start_round" });
        account(stats, r.events);
        let decisions = 0;
        while (r.state.phase !== "game_over") {
          if (r.state.phase === "round_over") { r = engine.step(r.state, { type: "start_round" }); account(stats, r.events); continue; }
          if (++decisions > MAX_DECISIONS_PER_GAME) throw new Error(`game ${gameId} exceeded ${MAX_DECISIONS_PER_GAME} decisions`);
          const id = engine.pendingPlayer(r.state);
          const seat = Number(id.slice(1)) - 1;
          const view = observeGame(r.state, id);
          const d = await decide(seatAdapters[seat].adapter, { gameView: view, gameId, timeoutMs: opts.timeoutMs });
          const st = stats[seat];
          st.decisions += 1; st.attempts += d.attempts.length; st.latencies.push(d.latency_ms);
          st.invalid += d.attempts.filter((a) => a.outcome === "invalid").length;
          st.timeouts += d.attempts.filter((a) => a.outcome === "timeout").length;
          st.fallbacks += d.fallback_used ? 1 : 0;
          if (d.action === "hit") st.hits += 1;
          write({ kind: "decision", game_id: gameId, turnNumber: r.state.turnNumber, player: id, agent: players[seat].agent, request: d.request, attempts: d.attempts, action: d.action, fallback_used: d.fallback_used, latency_ms: d.latency_ms });
          r = engine.step(r.state, { type: "act", player: id, action: d.action });
          account(stats, r.events);
        }
        const finalScores = Object.fromEntries(r.state.players.map((p) => [p.id, p.score]));
        write({ kind: "game_end", game_id: gameId, final_scores: finalScores, winner: r.state.winner, rounds: r.state.roundNumber, events: r.state.history });
        const top = Math.max(...Object.values(finalScores));
        for (const p of players) {
          const others = players.filter((q) => q.seat !== p.seat).map((q) => finalScores[q.id]);
          records.push({ seed, rotation, seat: p.seat, agent: p.agent, score: finalScores[p.id], won: finalScores[p.id] === top, points_vs_table: finalScores[p.id] - others.reduce((a, b) => a + b, 0) / others.length, rounds: r.state.roundNumber, ...stats[p.seat] });
        }
        for (const p of players) await seatAdapters[p.seat].adapter.end({ type: "end", game_id: gameId, result: { final_scores: finalScores, winner: r.state.winner, rounds: r.state.roundNumber } });
        gamesPlayed += 1;
        log(`game ${gamesPlayed}/${suite.seeds.length * suite.rotations} seed ${seed} rotation ${rotation}: ${JSON.stringify(finalScores)} winner ${r.state.winner}`);
      }
    }
  } catch (err) {
    aborted = true; abortMessage = err.message;
    log(`run aborted: ${err.message}`);
    if (!(err instanceof AdapterError)) {
      await Promise.allSettled(external.filter(Boolean).map((a) => a.shutdown()));
      write({ kind: "summary", run_id: runId, aborted: true, abort_message: err.message });
      await new Promise((resolve) => stream.end(resolve));
      writePrivate();
      throw err;
    }
  } finally {
    await Promise.allSettled(external.filter(Boolean).map((a) => a.shutdown()));
  }

  const metrics = computeMetrics(records);
  const underTest = opts.agents && opts.agents.length ? null : (specNames[0] ? keyOf(specNames[0]) : null);
  const summary = { run_id: runId, suite: suite.name, table: suite.table, seed_base: suite.seed_base, n_games: gamesPlayed, n_seeds: new Set(records.map((x) => x.seed)).size, aborted, abort_message: abortMessage, agent_under_test: underTest, agents: metrics };
  write({ kind: "summary", ...summary });
  await new Promise((resolve) => stream.end(resolve));
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  writePrivate();
  log(`wrote ${outFile}`);
  return { runId, dir, summary };
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    o[key] = val;
  }
  return o;
}

if (require.main === module) {
  const a = parseArgs(process.argv.slice(2));
  runBenchmark({
    agent: a.agent, agents: a.agents ? a.agents.split(",") : undefined, suite: a.suite || "standard",
    seeds: a.seeds ? Number(a.seeds) : undefined, table: a.table ? Number(a.table) : undefined, seedBase: a["seed-base"],
    opponents: a.opponents ? a.opponents.split(",") : DEFAULT_OPPONENTS, timeoutMs: a.timeout ? Number(a.timeout) : 30000, out: a.out || "bench/results",
  }).then(({ summary }) => {
    const key = summary.agent_under_test;
    if (key) {
      const m = summary.agents[key];
      console.log(`\n${key}: win_rate ${m.win_rate.value.toFixed(3)} [${m.win_rate.ci95.map((x) => x.toFixed(3)).join(", ")}]  points_vs_table ${m.points_vs_table.value.toFixed(1)} [${m.points_vs_table.ci95.map((x) => x.toFixed(1)).join(", ")}]  score/round ${m.mean_score_per_round.value.toFixed(2)}  bust_rate ${m.bust_rate.value.toFixed(3)}  fallback ${m.decisions_with_fallback_rate.value.toFixed(3)}  latency p95 ${m.latency_ms.p95} ms  (n_seeds ${m.n_seeds})`);
    }
    process.exit(summary.aborted ? 2 : 0);
  }, (err) => { console.error(err.message); process.exit(1); });
}

module.exports = { runBenchmark, seatSpecs, DEFAULT_OPPONENTS, SUITE_NAMES };
