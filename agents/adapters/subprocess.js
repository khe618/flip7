"use strict";
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { PROTOCOL } = require("../../lib/request");
const { AdapterError, TimeoutError } = require("../adapter");

const LINE_CAP = 64 * 1024;
const STDERR_CAP = 1024 * 1024;
const HOOK_MS = 10000;

function create(spec, command) {
  let child = null;
  let stderr = "";
  let exit = null;              // { code, signal } once the process has exited
  const waiting = new Map();    // request_id -> resolve
  let helloResolve = null;

  function fail(msg) { return new AdapterError(`${spec}: ${msg}${stderr ? "\n--- stderr ---\n" + stderr.slice(-2000) : ""}`); }

  function send(obj) {
    if (!child || exit) throw fail(`process exited (${exit ? `exit code ${exit.code}` : "not started"})`);
    child.stdin.write(JSON.stringify(obj) + "\n");
  }

  function onLine(line) {
    if (line.length > LINE_CAP) line = "";
    let msg;
    try { msg = JSON.parse(line); } catch { msg = { __raw: line }; }
    if (helloResolve) { const r = helloResolve; helloResolve = null; r(msg); return; }
    let id = msg && msg.request_id;
    // A reply without a request_id (non-JSON, or JSON missing the field) belongs to the only
    // pending request when there is exactly one; it is then judged invalid by decide().
    if (id === undefined && waiting.size === 1) id = waiting.keys().next().value;
    const resolve = waiting.get(id);
    if (!resolve) return;      // unknown or already-settled request: discard (late reply)
    waiting.delete(id);
    resolve(msg.__raw !== undefined ? msg.__raw : JSON.stringify(msg));
  }

  const adapter = {
    spec, name: "?", version: "?",
    stderr: () => stderr,
    async hello() {
      child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "pipe"] });
      child.stdin.on("error", () => {});   // EPIPE after the agent exits must not crash the runner
      child.stderr.on("data", (b) => { stderr = (stderr + String(b)).slice(-STDERR_CAP); });
      child.on("exit", (code, signal) => {
        exit = { code, signal };
        for (const [id, resolve] of waiting) { waiting.delete(id); resolve(null); }
        if (helloResolve) { const r = helloResolve; helloResolve = null; r(null); }
      });
      readline.createInterface({ input: child.stdout }).on("line", onLine);
      const helloPromise = new Promise((resolve) => { helloResolve = resolve; });
      send({ type: "hello", protocol: PROTOCOL });
      let helloTimer;
      const reply = await Promise.race([
        helloPromise,
        new Promise((_, reject) => { helloTimer = setTimeout(() => reject(fail("no hello reply within 10 s")), HOOK_MS); }),
      ]).finally(() => clearTimeout(helloTimer));
      if (reply === null) throw fail(`process exited with code ${exit && exit.code} before answering hello`);
      const h = reply || {};
      if (h.protocol !== PROTOCOL) throw fail(`protocol mismatch: got ${JSON.stringify(h.protocol)}, want ${PROTOCOL}`);
      adapter.name = String(h.name || "anonymous"); adapter.version = String(h.version || "0");
      return h;
    },
    async start(info) { send(info); },
    async move({ request_id, request }, timeoutMs) {
      if (exit) throw fail(`process exited with code ${exit.code}`);
      const p = new Promise((resolve) => waiting.set(request_id, resolve));
      send({ type: "move", request_id, request });
      const t = new Promise((_, reject) => setTimeout(() => { waiting.delete(request_id); reject(new TimeoutError(`no reply within ${timeoutMs} ms`)); }, timeoutMs).unref());
      const raw = await Promise.race([p, t]);
      if (raw === null) throw fail(`process exited with code ${exit && exit.code}`);
      return { raw };
    },
    async end(result) { if (!exit) send(result); },
    async shutdown() {
      if (!child || exit) return;
      child.stdin.end();
      await new Promise((resolve) => { const t = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2000); child.once("exit", () => { clearTimeout(t); resolve(); }); });
    },
  };
  return adapter;
}

module.exports = { create };
