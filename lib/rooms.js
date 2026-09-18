"use strict";

// Application close code for "another connection took this seat". The client
// must not auto-reconnect on it or two tabs trade the seat forever.
const SEAT_TAKEN_OVER_CODE = 4000;
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;
const BOT_POLICIES = ["threshold25", "bustRisk25", "adaptive"];
const BOT_NAMES_POOL = ["Ada", "Bea", "Cal", "Dev", "Eli", "Fay", "Gus", "Hal", "Ida", "Jo", "Kit", "Lou", "Max", "Nia", "Oz", "Pip", "Quin", "Rae", "Sol", "Tam", "Uma", "Val", "Wes", "Xan", "Yara", "Zed", "Ash", "Bo", "Cy", "Dot", "Ember", "Fox", "Gem", "Hux", "Ivy", "Jet", "Koa", "Lark", "Moss", "Nell"];
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

function normaliseName(raw) {
  const s = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 16);
  return s || "Player";
}

function fail(message, code) { return Object.assign(new Error(message), { code }); }

function createRegistry({ now, setTimeout: setT, clearTimeout: clearT, randomInt, randomBytes, config, onChange = () => {}, onDelete = () => {} }) {
  const rooms = new Map();
  const reservations = new Map(); // code -> reserved until
  const ttl = () => config.RESUME_TTL_MS;

  function guarded(label, fn) {
    return () => { try { fn(); } catch (err) { console.error(`[rooms] ${label} failed:`, err); } };
  }
  function cancel(obj, key) { if (obj[key]) { clearT(obj[key]); obj[key] = null; } }

  function reserveCode() {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = "";
      for (let i = 0; i < 4; i++) code += LETTERS[randomInt(26)];
      if (rooms.has(code)) continue;
      const until = reservations.get(code);
      if (until && until > now()) continue;
      reservations.set(code, now() + config.CODE_RESERVATION_MS);
      return code;
    }
    return null;
  }

  function get(code) { return rooms.get(code); }

  function getOrCreate(code) {
    let room = rooms.get(code);
    if (room) return room;
    room = { code, phase: "lobby", seats: new Map(), visitors: new Set(), game: null, nextSeatNo: 1, createdAt: now(), lastOccupantAt: now(), deletionTimer: null };
    rooms.set(code, room);
    reservations.delete(code);
    return room;
  }

  // Humans and agents keep a room alive; bots do not.
  function occupantsConnected(room) {
    let n = 0;
    for (const s of room.seats.values()) if (!s.isBot && s.connected) n++;
    return n;
  }

  function expiryAllowed(room) { return room.phase === "lobby" || room.phase === "game_over"; }

  function scheduleSeatExpiry(room, seat, ms) {
    cancel(seat, "expiryTimer");
    seat.expiryTimer = setT(guarded("seat expiry", () => {
      seat.expiryTimer = null;
      if (seat.connected || !room.seats.has(seat.id) || !expiryAllowed(room)) return;
      room.seats.delete(seat.id);
      onChange(room);
    }), ms);
  }

  function scheduleDeletion(room, ms) {
    cancel(room, "deletionTimer");
    room.deletionTimer = setT(guarded("room deletion", () => {
      room.deletionTimer = null;
      if (occupantsConnected(room) > 0) return;
      if (rooms.get(room.code) === room) remove(room.code);
    }), ms);
  }

  function remove(code) {
    const room = rooms.get(code);
    if (!room) return;
    cancel(room, "deletionTimer");
    for (const seat of room.seats.values()) cancel(seat, "expiryTimer");
    if (room.game && room.game.dispose) room.game.dispose();
    rooms.delete(code);
    onDelete(code);
  }

  function newSeat(room, fields) {
    const id = `s${room.nextSeatNo++}`;
    const seat = { id, name: "", isBot: false, isAgent: false, botPolicy: null, resumeToken: null, ws: null, connected: false, disconnectedAt: 0, expiryTimer: null, ...fields };
    room.seats.set(id, seat);
    return seat;
  }

  function join(room, { name, ws, isAgent = false }) {
    if (room.phase !== "lobby") throw fail("Game in progress.", "game_in_progress");
    if (room.seats.size >= MAX_PLAYERS) throw fail("Room is full.", "room_full");
    const seat = newSeat(room, { name: normaliseName(name), isAgent: !!isAgent, resumeToken: randomBytes(16).toString("hex"), ws, connected: true });
    room.visitors.delete(ws);
    cancel(room, "deletionTimer");
    room.lastOccupantAt = now();
    return seat;
  }

  // The token is the identity: the newest socket presenting it owns the seat.
  // Never gate on `connected` (emoji LEARNINGS 2026-08-31).
  function resume(room, token, ws) {
    if (!token) return null;
    let seat = null;
    for (const s of room.seats.values()) if (!s.isBot && s.resumeToken === token) { seat = s; break; }
    if (!seat) return null;
    const previous = seat.ws;
    seat.ws = ws; seat.connected = true; seat.disconnectedAt = 0;
    cancel(seat, "expiryTimer");
    room.visitors.delete(ws);
    cancel(room, "deletionTimer");
    room.lastOccupantAt = now();
    if (previous && previous !== ws) { try { previous.close(SEAT_TAKEN_OVER_CODE, "seat_taken_over"); } catch { /* already gone */ } }
    return seat;
  }

  function disconnect(room, ws) {
    for (const seat of room.seats.values()) {
      if (seat.ws !== ws) continue;
      seat.ws = null; seat.connected = false; seat.disconnectedAt = now();
      if (expiryAllowed(room)) scheduleSeatExpiry(room, seat, ttl());
      if (occupantsConnected(room) === 0) scheduleDeletion(room, ttl());
      return true;
    }
    return false;
  }

  function attachVisitor(room, ws) { room.visitors.add(ws); }
  function detachVisitor(room, ws) {
    room.visitors.delete(ws);
    if (room.seats.size === 0 && room.visitors.size === 0 && rooms.get(room.code) === room) remove(room.code);
  }

  function addBot(room) {
    if (room.seats.size >= MAX_PLAYERS) throw fail("Room is full.", "room_full");
    const taken = new Set([...room.seats.values()].map((s) => s.name));
    const free = BOT_NAMES_POOL.filter((n) => !taken.has(n));
    const name = free.length ? free[randomInt(free.length)] : `Bot ${room.nextSeatNo}`;
    return newSeat(room, { name, isBot: true, connected: true, botPolicy: BOT_POLICIES[randomInt(BOT_POLICIES.length)] });
  }

  function removeBot(room, id) {
    const s = room.seats.get(id);
    if (!s || !s.isBot) return false;
    room.seats.delete(id);
    return true;
  }

  // Re-evaluate expiry and deletion from elapsed time (used when a game returns to the lobby).
  function sweep(room) {
    for (const seat of [...room.seats.values()]) {
      if (seat.isBot || seat.connected || !expiryAllowed(room)) continue;
      const elapsed = now() - seat.disconnectedAt;
      if (elapsed >= ttl()) { cancel(seat, "expiryTimer"); room.seats.delete(seat.id); }
      else scheduleSeatExpiry(room, seat, ttl() - elapsed);
    }
    if (occupantsConnected(room) === 0 && !room.deletionTimer) scheduleDeletion(room, ttl());
  }

  return { rooms, reserveCode, get, getOrCreate, delete: remove, join, resume, disconnect, attachVisitor, detachVisitor, addBot, removeBot, sweep, occupantsConnected };
}

module.exports = { createRegistry, SEAT_TAKEN_OVER_CODE, MAX_PLAYERS, MIN_PLAYERS, BOT_POLICIES, BOT_NAMES_POOL, normaliseName };
