"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRegistry, SEAT_TAKEN_OVER_CODE } = require("../lib/rooms");
const { readConfig } = require("../lib/config");
const rng = require("../lib/rng");
const { createClock } = require("./helpers/clock");

function fakeWs() { const ws = { closed: null, readyState: 1, close(code, reason) { ws.closed = { code, reason }; ws.readyState = 3; } }; return ws; }

function setup(over = {}) {
  const clock = createClock(1000);
  const deleted = [];
  const config = { ...readConfig({}), RESUME_TTL_MS: 500, CODE_RESERVATION_MS: 100, ...over };
  const rand = rng.createRandom(1);
  let n = 0;
  const registry = createRegistry({
    now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    randomInt: (max) => Math.floor(rand() * max), randomBytes: (k) => Buffer.alloc(k, n++ % 256), config,
    createGame: () => ({ dispose() {} }), onChange: () => {}, onDelete: (code) => deleted.push(code),
  });
  return { clock, registry, deleted };
}

test("reserveCode returns unique 4-letter codes and honours reservations", () => {
  const { registry, clock } = setup();
  const a = registry.reserveCode();
  assert.match(a, /^[a-z]{4}$/);
  const seen = new Set([a]);
  for (let i = 0; i < 50; i++) { const c = registry.reserveCode(); assert.ok(!seen.has(c)); seen.add(c); }
  clock.advance(101);
  assert.ok(registry.reserveCode());
});

test("join seats a player with a resume token; room_full and game_in_progress are refused", () => {
  const { registry } = setup();
  const room = registry.getOrCreate("abcd");
  const seat = registry.join(room, { name: "  Kay  ", ws: fakeWs() });
  assert.equal(seat.name, "Kay");
  assert.match(seat.resumeToken, /^[0-9a-f]{32}$/);
  assert.equal(seat.connected, true);
  for (let i = 0; i < 5; i++) registry.join(room, { name: "P" + i, ws: fakeWs() });
  assert.throws(() => registry.join(room, { name: "extra", ws: fakeWs() }), (e) => e.code === "room_full");
  room.phase = "playing";
  const r2 = registry.getOrCreate("wxyz");
  r2.phase = "playing";
  assert.throws(() => registry.join(r2, { name: "late", ws: fakeWs() }), (e) => e.code === "game_in_progress");
});

test("resume adopts the seat unconditionally and displaces the old socket with 4000", () => {
  const { registry } = setup();
  const room = registry.getOrCreate("abcd");
  const oldWs = fakeWs();
  const seat = registry.join(room, { name: "Kay", ws: oldWs });
  const newWs = fakeWs();
  const adopted = registry.resume(room, seat.resumeToken, newWs);
  assert.equal(adopted, seat);
  assert.equal(seat.ws, newWs);
  assert.deepEqual(oldWs.closed, { code: SEAT_TAKEN_OVER_CODE, reason: "seat_taken_over" });
  assert.equal(registry.resume(room, "nope", fakeWs()), null);
  // the old socket's late close must not clear the new socket
  registry.disconnect(room, oldWs);
  assert.equal(seat.connected, true);
  assert.equal(seat.ws, newWs);
});

test("seats expire only in lobby and game_over; rooms die without occupants; agents count as occupants", () => {
  const { registry, clock, deleted } = setup();
  const room = registry.getOrCreate("abcd");
  const ws = fakeWs();
  const seat = registry.join(room, { name: "Kay", ws });
  registry.addBot(room);
  registry.disconnect(room, ws);
  assert.equal(seat.connected, false);
  clock.advance(501);
  assert.ok(!room.seats.has(seat.id), "lobby seat expired");
  assert.deepEqual(deleted, ["abcd"], "no occupant for the TTL deletes the room");

  const r2 = registry.getOrCreate("efgh");
  const ws2 = fakeWs();
  const s2 = registry.join(r2, { name: "Kay", ws: ws2 });
  r2.phase = "playing";
  registry.disconnect(r2, ws2);
  clock.advance(300);
  assert.ok(r2.seats.has(s2.id), "mid-game seat retained");
  clock.advance(300);
  assert.ok(deleted.includes("efgh"), "but the room is deleted after the TTL with nobody connected");

  const r3 = registry.getOrCreate("ijkl");
  registry.join(r3, { name: "bot-driver", ws: fakeWs(), isAgent: true });
  const human = fakeWs();
  registry.join(r3, { name: "Kay", ws: human });
  registry.disconnect(r3, human);
  clock.advance(2000);
  assert.ok(!deleted.includes("ijkl"), "a connected agent keeps the room alive");
  assert.equal(registry.occupantsConnected(r3), 1);
});

test("bots get names and policies; visitors-only rooms vanish when the last visitor leaves", () => {
  const { registry, deleted } = setup();
  const room = registry.getOrCreate("abcd");
  const b = registry.addBot(room);
  assert.equal(b.isBot, true);
  assert.ok(["threshold25", "bustRisk25", "adaptive"].includes(b.botPolicy));
  assert.ok(b.name.length > 0);
  registry.removeBot(room, b.id);
  assert.equal(room.seats.size, 0);
  const v = fakeWs();
  registry.attachVisitor(room, v);
  registry.detachVisitor(room, v);
  assert.deepEqual(deleted, ["abcd"]);
});
