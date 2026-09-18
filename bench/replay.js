"use strict";
const fs = require("node:fs");
const path = require("node:path");
const engine = require("../lib/engine");
const { observeGame } = require("../lib/view");

function verifyReplay(file) {
  const recs = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  // Seeds are not in games.jsonl (spec §6.3): they live in the runner's private sidecar next to it.
  const privateFile = path.join(path.dirname(path.resolve(file)), "run-private.json");
  let priv;
  try { priv = JSON.parse(fs.readFileSync(privateFile, "utf8")); }
  catch (err) { throw new Error(`cannot replay without the run's seeds: ${privateFile} is missing or unreadable (${err.message})`); }
  const seedOf = (gameId) => {
    const g = priv.games && priv.games[gameId];
    if (!g || typeof g.seed !== "number") throw new Error(`${privateFile} has no seed for game ${gameId}`);
    return g.seed;
  };
  const failures = [];
  let games = 0;
  let i = 0;
  while (i < recs.length) {
    if (recs[i].kind !== "game_start") { i++; continue; }
    const start = recs[i++];
    games++;
    let r;
    try {
      r = engine.step(engine.createGame({ players: start.seats.map((p) => ({ id: p.id, name: p.name })), seed: seedOf(start.game_id) }), { type: "start_round" });
    } catch (err) { failures.push({ game_id: start.game_id, turnNumber: 0, message: err.message }); continue; }
    let broken = false;
    while (i < recs.length && recs[i].kind === "decision") {
      const d = recs[i++];
      if (broken) continue;
      try {
        while (r.state.phase === "round_over") r = engine.step(r.state, { type: "start_round" });
        const view = observeGame(r.state, d.player);
        if (r.state.turnNumber !== d.turnNumber || engine.pendingPlayer(r.state) !== d.player) throw new Error(`expected turn ${d.turnNumber} for ${d.player}, engine is at turn ${r.state.turnNumber} for ${engine.pendingPlayer(r.state)}`);
        if (JSON.stringify(view) !== JSON.stringify(d.request.game)) throw new Error("logged game view differs from the recomputed view");
        r = engine.step(r.state, { type: "act", player: d.player, action: d.action });
      } catch (err) { failures.push({ game_id: start.game_id, turnNumber: d.turnNumber, message: err.message }); broken = true; }
    }
    if (i < recs.length && recs[i].kind === "game_end") {
      const end = recs[i++];
      if (!broken) {
        const scores = Object.fromEntries(r.state.players.map((p) => [p.id, p.score]));
        if (JSON.stringify(scores) !== JSON.stringify(end.final_scores) || r.state.winner !== end.winner) failures.push({ game_id: start.game_id, turnNumber: r.state.turnNumber, message: "final scores or winner differ" });
        else if (JSON.stringify(r.state.history) !== JSON.stringify(end.events)) failures.push({ game_id: start.game_id, turnNumber: r.state.turnNumber, message: "event history differs" });
      }
    }
  }
  return { games, failures };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error("usage: node bench/replay.js <games.jsonl>"); process.exit(1); }
  let result;
  try { result = verifyReplay(file); }
  catch (err) { console.error(err.message); process.exit(1); }   // e.g. no run-private.json beside the log
  const { games, failures } = result;
  for (const f of failures) console.error(`game ${f.game_id} turn ${f.turnNumber}: ${f.message}`);
  console.log(`${games} games replayed, ${failures.length} failures`);
  process.exit(failures.length ? 1 : 0);
}

module.exports = { verifyReplay };
