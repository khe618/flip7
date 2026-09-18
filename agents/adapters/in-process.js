"use strict";
const { PROTOCOL } = require("../../lib/request");
const bots = require("../../lib/bots");
const rng = require("../../lib/rng");
const { withTimeout, AdapterError } = require("../adapter");

const HOOK_MS = 10000;

function wrap(spec, mod, { random } = {}) {
  if (typeof mod.act !== "function") throw new Error(`in-process agent ${spec} has no act()`);
  const adapter = {
    spec, name: mod.name || "anonymous", version: String(mod.version || "0"),
    async hello() { return { name: adapter.name, version: adapter.version, protocol: PROTOCOL }; },
    async start(info) {
      if (!mod.start) return;
      try { await withTimeout(Promise.resolve().then(() => mod.start(info)), HOOK_MS); }
      catch (err) { throw new AdapterError(`${spec}: start failed: ${err.message}`); }
    },
    move({ request }, timeoutMs) {
      // A promise still pending after the deadline is ignored when it settles.
      const p = Promise.resolve().then(() => mod.act(request, random)).then((out) => ({ raw: typeof out === "string" ? out : JSON.stringify(out) }));
      return withTimeout(p, timeoutMs);
    },
    async end(result) {
      if (!mod.end) return;
      try { await withTimeout(Promise.resolve().then(() => mod.end(result)), HOOK_MS); } catch { /* logged by caller's stderr, ignored */ }
    },
    async shutdown() {},
  };
  return adapter;
}

function fromBot(spec, { random } = {}) {
  const name = spec.slice(4);
  return wrap(spec, bots.createBot(name, { random: random || rng.createRandom(name) }));
}

function fromModule(spec, file) {
  // ?fresh=... in the spec forces a fresh module instance (tests reuse a fixture with different modes).
  if (spec.includes("?")) delete require.cache[require.resolve(file)];
  return wrap(spec, require(file));
}

module.exports = { wrap, fromBot, fromModule };
