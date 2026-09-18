"use strict";
const crypto = require("node:crypto");

const PROTOCOL = "flip7-agent/1";

function newRequestId() { return crypto.randomBytes(3).toString("hex"); }

function makeRequest(gameView, { gameId, timeoutMs, retry = null, requestId = newRequestId() }) {
  return { protocol: PROTOCOL, request_id: requestId, game_id: gameId, timeout_ms: timeoutMs, retry, game: gameView };
}

module.exports = { PROTOCOL, makeRequest, newRequestId };
