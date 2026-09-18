"use strict";
const path = require("node:path");

class TimeoutError extends Error { constructor(msg = "timeout") { super(msg); this.name = "TimeoutError"; } }
class AdapterError extends Error { constructor(msg) { super(msg); this.name = "AdapterError"; } }

function withTimeout(promise, ms, onTimeout) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { if (onTimeout) onTimeout(); reject(new TimeoutError(`no reply within ${ms} ms`)); }, ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function resolveAgent(spec, opts = {}) {
  if (typeof spec !== "string" || !spec) throw new AdapterError("empty agent spec");
  if (spec.startsWith("bot:")) return require("./adapters/in-process").fromBot(spec, opts);
  if (spec.startsWith("file:")) {
    const [file] = spec.slice(5).split("?");
    return require("./adapters/in-process").fromModule(spec, path.resolve(process.cwd(), file));
  }
  if (spec.startsWith("cmd:")) return require("./adapters/subprocess").create(spec, spec.slice(4));
  if (/^https?:\/\//.test(spec)) return require("./adapters/http").create(spec, spec);
  throw new AdapterError(`unrecognised agent spec "${spec}" (expected bot:, file:, cmd:, or http://)`);
}

module.exports = { resolveAgent, TimeoutError, AdapterError, withTimeout };
