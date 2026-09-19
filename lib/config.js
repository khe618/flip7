"use strict";

const DEFAULTS = {
  PORT: 3000,
  TURN_MS: 30000,
  BOT_DELAY_MIN_MS: 1800,
  BOT_DELAY_MAX_MS: 2600,
  ROUND_SUMMARY_MS: 8000,
  RESUME_TTL_MS: 600000,
  CODE_RESERVATION_MS: 60000,
  HEARTBEAT_MS: 30000,
  MAX_PAYLOAD: 16384,
};

function envInt(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function readConfig(env = process.env) {
  const out = {};
  for (const [key, value] of Object.entries(DEFAULTS)) out[key] = envInt(env, key, value);
  return out;
}

module.exports = { DEFAULTS, readConfig };
