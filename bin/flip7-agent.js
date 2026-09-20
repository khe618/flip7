#!/usr/bin/env node
"use strict";
// npx flip7-agent <room> --agent <spec>: seats an agent at a live Flip 7 Arena room.
// Thin: parsing is agents/cli.js, the driver is bench/live.js; this file maps events to lines
// and errors to exit codes (0 game ended, 1 usage, 2 adapter, 3 seat taken over, 4 room full,
// 130/143 on SIGINT/SIGTERM).
// stdout/stderr to a pipe are async on POSIX; an empty write's callback runs after everything
// queued before it has been flushed, so this avoids truncating the last line (e.g. "game over")
// when piped or spawned with piped stdio. Hoisted (function declaration) so every early exit
// below can flush through it too.
function exit(code) {
  process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
}

// exit() is a flush-then-exit helper, not an immediate terminator like process.exit(), so every
// early-exit call below is paired with a `return` (legal here: Node wraps a CJS module body in a
// function) to stop the rest of the module from running while the flush is in flight.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) { console.error(`flip7-agent needs Node 22.12 or newer (this is ${process.versions.node})`); exit(1); return; }

const { parseArgs, UsageError, USAGE, DEFAULT_URL } = require("../agents/cli");
const { driveLiveSeat, exitCodeFor } = require("../bench/live");
const { version } = require("../package.json");

let args;
try { args = parseArgs(process.argv.slice(2), { defaultUrl: DEFAULT_URL }); }
catch (err) { if (!(err instanceof UsageError)) throw err; console.error(`flip7-agent: ${err.message}\n\n${USAGE}`); exit(1); return; }
if (args.help) { console.log(USAGE); exit(0); return; }
if (args.version) { console.log(version); exit(0); return; }

const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
function onEvent(e) {
  switch (e.type) {
    case "ready": console.log(`agent ${e.name}@${e.version} ready`); break;
    case "seated": console.log(`seated as ${e.playerId} in room ${e.room}; start the game from the browser`); break;
    case "waiting": console.log(`waiting for the lobby (${e.reason})`); break;
    case "decision": if (!args.quiet) console.log(`turn ${e.turnNumber}: ${e.action} (${secs(e.latencyMs)}${e.fallback ? `, fallback: ${e.fallback}` : ""})`); break;
    case "game_over": console.log(`game over: ${e.standings.map((s) => `${s.name} ${s.score}`).join(", ")}`); break;
    case "reconnecting": console.log(`connection lost, reconnecting in ${secs(e.delayMs)}`); break;
    case "error": console.error(`server: ${e.code} ${e.message}`); break;
    default: break;
  }
}

let driver;
try { driver = driveLiveSeat({ url: args.url, room: args.room, spec: args.spec, name: args.name, onEvent }); }
catch (err) { console.error(`flip7-agent: ${err.message}`); exit(2); return; }   // resolveAgent rejects bad specs synchronously

// First stop wins: a second signal exits immediately with the code chosen by the first.
let exitCode = null;
function stop(code) {
  if (exitCode !== null) { exit(exitCode); return; }
  exitCode = code;
  process.exitCode = code;
  setTimeout(() => exit(exitCode), 3000);
  driver.close().then(() => exit(exitCode), () => exit(exitCode));
}
process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));
driver.done.then(() => stop(0), (err) => { console.error(`flip7-agent: ${err.message}`); stop(exitCodeFor(err)); });
