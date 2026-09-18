"use strict";
const { PROTOCOL } = require("../../lib/request");
const { AdapterError, TimeoutError } = require("../adapter");

const BODY_CAP = 64 * 1024;
const HOOK_MS = 10000;

function create(spec, base) {
  const url = base.replace(/\/+$/, "");
  async function call(method, pathname, body, timeoutMs) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url + pathname, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: ac.signal });
      const text = await res.text();
      return { status: res.status, text: text.slice(0, BODY_CAP + 1) };
    } catch (err) {
      if (err.name === "AbortError") throw new TimeoutError(`no reply within ${timeoutMs} ms`);
      throw err;
    } finally { clearTimeout(t); }
  }
  const adapter = {
    spec, name: "?", version: "?",
    async hello() {
      let r;
      try { r = await call("GET", "/", undefined, HOOK_MS); }
      catch (err) { throw new AdapterError(`${spec}: hello failed: ${err.message}`); }
      if (r.status !== 200) throw new AdapterError(`${spec}: hello returned HTTP ${r.status}`);
      let h;
      try { h = JSON.parse(r.text); } catch { throw new AdapterError(`${spec}: hello returned non-JSON`); }
      if (h.protocol !== PROTOCOL) throw new AdapterError(`${spec}: protocol mismatch: got ${JSON.stringify(h.protocol)}, want ${PROTOCOL}`);
      adapter.name = String(h.name || "anonymous"); adapter.version = String(h.version || "0");
      return h;
    },
    async start(info) {
      let r;
      try { r = await call("POST", "/start", info, HOOK_MS); } catch (err) { throw new AdapterError(`${spec}: start failed: ${err.message}`); }
      if (r.status !== 200) throw new AdapterError(`${spec}: start returned HTTP ${r.status}`);
    },
    async move({ request_id, request }, timeoutMs) {
      let r;
      try { r = await call("POST", "/move", { request_id, request }, timeoutMs); }
      catch (err) { if (err instanceof TimeoutError) throw err; return { raw: `connection error: ${err.message}` }; }
      if (r.status !== 200) return { raw: `http ${r.status}: ${r.text.slice(0, 200)}` };
      if (r.text.length > BODY_CAP) return { raw: "reply body over 64 KB" };
      return { raw: r.text };
    },
    async end(result) { try { await call("POST", "/end", result, HOOK_MS); } catch { /* ignored */ } },
    async shutdown() {},
  };
  return adapter;
}

module.exports = { create };
