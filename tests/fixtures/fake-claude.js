"use strict";
// Stand-in for the `claude` executable. Behaviour from env FAKE_CLAUDE_MODE:
//   ok (default)  answers the probe with {"action":"ok"} and a move with a legal action; the
//                 result also carries argv, whether CLAUDECODE was set, and the stdin length
//   probe-error   the probe returns is_error (like "Not logged in")
//   error         every move returns is_error
//   error-twice   moves 1 and 2 return is_error, later moves are ok (counts via FAKE_CLAUDE_COUNTER file)
//   nonjson       prints prose instead of JSON
//   exit1         exits 1 with stderr
//   eof-early     exits 0 without reading stdin (the adapter must survive EPIPE)
//   sleep         answers after 5 s (the adapter must kill it first); writes its pid to FAKE_CLAUDE_PIDFILE
//   huge          prints 70 KB of junk
const fs = require("node:fs");
const mode = process.env.FAKE_CLAUDE_MODE || "ok";
const argv = process.argv.slice(2);
if (argv.includes("--version")) { process.stdout.write("9.9.9 (Claude Code)\n"); process.exit(0); }
if (mode === "eof-early") process.exit(0);
if (process.env.FAKE_CLAUDE_PIDFILE) fs.appendFileSync(process.env.FAKE_CLAUDE_PIDFILE, `${process.pid}\n`);
let input = "";
process.stdin.on("data", (b) => { input += b; });
process.stdin.on("end", () => {
  const isProbe = /"action": "ok"/.test(input);
  const reply = (result, is_error = false) => { process.stdout.write(JSON.stringify({ type: "result", is_error, result, modelUsage: { "claude-fake-1": { inputTokens: 1 } } })); };
  const count = () => { const f = process.env.FAKE_CLAUDE_COUNTER; if (!f) return 0; let n = 0; try { n = Number(fs.readFileSync(f, "utf8")) || 0; } catch { /* first run */ } fs.writeFileSync(f, String(n + 1)); return n + 1; };
  if (isProbe) { if (mode === "probe-error") reply("Not logged in · Please run /login", true); else reply("{\"action\": \"ok\"}"); return; }
  if (mode === "error") { reply("API Error: 529 overloaded", true); return; }
  if (mode === "error-twice") { if (count() <= 2) { reply("API Error: 529 overloaded", true); return; } }
  if (mode === "nonjson") { process.stdout.write("something went wrong\n"); return; }
  if (mode === "exit1") { process.stderr.write("boom\n"); process.exit(1); }
  if (mode === "sleep") { setTimeout(() => reply("{\"action\": \"stay\"}"), 5000); return; }
  if (mode === "huge") { process.stdout.write("x".repeat(70000)); return; }
  const legal = (input.match(/Legal actions: (.*)/) || [null, "stay"])[1].split(", ");
  reply(JSON.stringify({ action: legal.includes("stay") ? "stay" : legal[0], argv, claudecode: process.env.CLAUDECODE === undefined ? null : process.env.CLAUDECODE, inputLength: input.length }));
});
