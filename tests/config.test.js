"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readConfig } = require("../lib/config");

test("readConfig returns every documented default", () => {
  const c = readConfig({});
  assert.deepEqual(c, {
    PORT: 3000, TURN_MS: 30000, BOT_DELAY_MIN_MS: 700, BOT_DELAY_MAX_MS: 1500,
    ROUND_SUMMARY_MS: 8000, RESUME_TTL_MS: 600000, CODE_RESERVATION_MS: 60000,
    HEARTBEAT_MS: 30000, MAX_PAYLOAD: 16384,
  });
});

test("readConfig parses integer overrides and ignores junk", () => {
  const c = readConfig({ PORT: "4010", TURN_MS: "abc", RESUME_TTL_MS: "400" });
  assert.equal(c.PORT, 4010);
  assert.equal(c.TURN_MS, 30000);
  assert.equal(c.RESUME_TTL_MS, 400);
});
