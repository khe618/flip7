"use strict";
// Command-line parsing shared by bin/flip7-agent.js (production default URL) and the
// bench/live.js wrapper (localhost default). Pure: no I/O, no process access.

const DEFAULT_URL = "wss://flip7-arena.onrender.com";
const CODE = /^[a-z]{4}$/;
const WS_PROTO = { "https:": "wss:", "wss:": "wss:", "http:": "ws:", "ws:": "ws:" };

class UsageError extends Error { constructor(msg) { super(msg); this.name = "UsageError"; } }

const USAGE = [
  "usage: flip7-agent <room> --agent <spec> [--name <name>] [--url <ws-url>] [--model <model>] [--quiet]",
  "",
  "  <room>          a room link (https://flip7-arena.onrender.com/abcd) or a four-letter room code",
  "  --agent <spec>  claude-code | claude-code:<model> | file:./agent.js | cmd:\"python agent.py\" | http://host:port | bot:<name>",
  "  --name <name>   seat name (default: the agent's own name)",
  "  --url <ws-url>  server for a bare room code (default: " + DEFAULT_URL + ")",
  "  --model <m>     model for claude-code (same as --agent claude-code:<m>)",
  "  --quiet         do not print one line per decision",
  "  --help, --version",
  "",
  "Whoever opened the room starts the game from their browser. Protocol: https://flip7-arena.onrender.com/agent-protocol",
].join("\n");

// "https://host/abcd" -> { url: "wss://host", room: "abcd" }; "abcd" -> { url: defaultUrl, room: "abcd" }.
function parseRoom(input, defaultUrl) {
  const s = String(input || "").trim();
  if (CODE.test(s)) return { url: defaultUrl, room: s };
  let u;
  try { u = new URL(s); } catch { throw new UsageError(`"${s}" is not a room link or a four-letter room code`); }
  const proto = WS_PROTO[u.protocol];
  if (!proto) throw new UsageError(`room link "${s}" must start with http, https, ws, or wss`);
  const seg = u.pathname.split("/").filter(Boolean)[0] || "";
  if (!CODE.test(seg)) throw new UsageError(`room link "${s}" has no four-letter room code in its path`);
  return { url: `${proto}//${u.host}`, room: seg };
}

function parseServerUrl(s) {
  let u;
  try { u = new URL(s); } catch { throw new UsageError(`--url "${s}" is not a URL`); }
  const proto = WS_PROTO[u.protocol];
  if (!proto) throw new UsageError(`--url "${s}" must start with ws, wss, http, or https`);
  return `${proto}//${u.host}`;
}

function parseArgs(argv, { defaultUrl }) {
  const out = { url: null, room: null, spec: null, name: null, quiet: false, help: false, version: false };
  let positional = null, roomFlag = null, urlFlag = null, model = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[i + 1]; if (v === undefined || v.startsWith("--")) throw new UsageError(`${a} needs a value`); i += 1; return v; };
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--version" || a === "-v") out.version = true;
    else if (a === "--quiet") out.quiet = true;
    else if (a === "--agent") out.spec = val();
    else if (a === "--name") out.name = val();
    else if (a === "--url") urlFlag = parseServerUrl(val());
    else if (a === "--room") roomFlag = val();
    else if (a === "--model") model = val();
    else if (a.startsWith("--")) throw new UsageError(`unknown option ${a}`);
    else if (positional === null) positional = a;
    else throw new UsageError(`unexpected argument ${a}`);
  }
  if (out.help || out.version) return out;
  const roomInput = positional !== null ? positional : roomFlag;
  if (!roomInput) throw new UsageError("a room link or four-letter room code is required");
  if (!out.spec) throw new UsageError("--agent <spec> is required");
  const r = parseRoom(roomInput, urlFlag || defaultUrl);
  out.url = r.url; out.room = r.room;
  if (model !== null) {
    if (out.spec === "claude-code") out.spec = `claude-code:${model}`;
    else if (out.spec.startsWith("claude-code:")) { if (out.spec.slice("claude-code:".length) !== model) throw new UsageError(`--model ${model} conflicts with --agent ${out.spec}`); }
    else throw new UsageError("--model applies only to --agent claude-code");
  }
  return out;
}

module.exports = { parseArgs, parseRoom, UsageError, USAGE, DEFAULT_URL };
