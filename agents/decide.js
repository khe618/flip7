"use strict";
const { makeRequest, newRequestId } = require("../lib/request");
const { defaultAction } = require("../lib/defaults");
const { renderRequest, hashText, PROMPT_VERSION } = require("../lib/render-text");
const { TimeoutError, AdapterError } = require("./adapter");

function parseAction(raw, legal) {
  let value = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    try { value = JSON.parse(trimmed); } catch { value = trimmed; }
  }
  let action;
  if (typeof value === "string") action = value;
  else if (value && typeof value === "object" && typeof value.action === "string") action = value.action;
  else return { error: `no action in reply ${JSON.stringify(raw).slice(0, 200)}` };
  if (!legal.includes(action)) return { error: `illegal action "${action}"; legal: ${legal.join(", ")}` };
  return { action };
}

// Spec §5.4. Returns the decision record the runner logs.
async function decide(adapter, { gameView, gameId, timeoutMs, retry = true, now = Date.now }) {
  const attempts = [];
  const started = now();
  let retryInfo = null;
  let firstRequest = null;
  for (let attempt = 1; attempt <= (retry ? 2 : 1); attempt++) {
    const request = makeRequest(gameView, { gameId, timeoutMs, retry: retryInfo, requestId: newRequestId() });
    if (!firstRequest) firstRequest = request;
    const text = renderRequest(request);
    const t0 = now();
    const rec = { request_id: request.request_id, raw_response: null, outcome: null, invalid_reason: null, latency_ms: 0, prompt_version: PROMPT_VERSION, prompt_hash: hashText(text) };
    try {
      const { raw } = await adapter.move({ request_id: request.request_id, request }, timeoutMs);
      rec.latency_ms = now() - t0;
      rec.raw_response = typeof raw === "string" ? raw.slice(0, 8192) : JSON.stringify(raw).slice(0, 8192);
      const parsed = parseAction(raw, gameView.legal_actions);
      if (parsed.action) { rec.outcome = "ok"; attempts.push(rec); return { action: parsed.action, request: firstRequest, attempts, fallback_used: false, latency_ms: now() - started }; }
      rec.outcome = "invalid"; rec.invalid_reason = parsed.error; attempts.push(rec);
      retryInfo = { attempt: attempt + 1, reason: parsed.error, previous: rec.raw_response };
    } catch (err) {
      rec.latency_ms = now() - t0;
      if (err instanceof TimeoutError) { rec.outcome = "timeout"; rec.invalid_reason = err.message; attempts.push(rec); break; }
      if (err instanceof AdapterError) throw err;
      throw new AdapterError(`${adapter.spec}: ${err.message}`);
    }
  }
  const request = makeRequest(gameView, { gameId, timeoutMs, retry: null, requestId: "fallback" });
  return { action: defaultAction(request), request: firstRequest || request, attempts, fallback_used: true, latency_ms: now() - started };
}

module.exports = { decide, parseAction };
