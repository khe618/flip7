"use strict";
// JSONL agent for tests. MODE=ok answers stay; MODE=invalid-once answers junk on the
// first move then stay; MODE=slow sleeps 200ms then answers; MODE=crash exits after hello.
const readline = require("node:readline");
const mode = process.env.MODE || "ok";
let moves = 0;
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.type === "hello") {
    process.stdout.write(JSON.stringify({ name: "echo", version: "t", protocol: "flip7-agent/1" }) + "\n");
    if (mode === "crash") process.exit(3);
    return;
  }
  if (msg.type !== "move") return;
  moves++;
  const legal = msg.request.game.legal_actions;
  const reply = (action) => process.stdout.write(JSON.stringify({ request_id: msg.request_id, action }) + "\n");
  if (mode === "invalid-once" && moves === 1) { process.stdout.write("not json\n"); return; }
  if (mode === "slow") { setTimeout(() => reply(legal.includes("stay") ? "stay" : legal[0]), 200); return; }
  process.stderr.write(`move ${moves}\n`);
  reply(legal.includes("stay") ? "stay" : legal[0]);
});
