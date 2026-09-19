"use strict";
const engine = require("./engine");
const { observeGame } = require("./view");
const { makeRequest, newRequestId } = require("./request");
const { defaultAction } = require("./defaults");
const bots = require("./bots");

// `deck` is a test-only explicit deck order passed through to engine.createGame.
function createRoomGame({ config, now, setTimeout, clearTimeout, random, seed, deck = null, onChange, log = () => {} }) {
  let state = null;
  let gameId = 0;
  const timers = { turn: null, summary: null, bot: null };
  const botAgents = new Map();

  function epoch() { return { gameId, roundNumber: state ? state.roundNumber : 0, turnNumber: state ? state.turnNumber : 0 }; }
  function sameEpoch(e) { const c = epoch(); return e.gameId === c.gameId && e.roundNumber === c.roundNumber && e.turnNumber === c.turnNumber; }
  function clear(kind) { if (timers[kind]) { clearTimeout(timers[kind].handle); timers[kind] = null; } }
  function arm(kind, ms, fn) {
    clear(kind);
    const entry = { e: epoch(), due: now() + ms, handle: null };
    entry.handle = setTimeout(() => {
      if (timers[kind] !== entry) return;
      timers[kind] = null;
      if (!sameEpoch(entry.e)) return;
      try { fn(); } catch (err) { log(`[room-game] ${kind} timer failed`, err); }
    }, ms);
    timers[kind] = entry;
  }

  function apply(input) {
    state = engine.step(state, input).state;
    afterStep();
  }

  function requestFor(id) { return makeRequest(observeGame(state, id), { gameId: String(gameId), timeoutMs: config.TURN_MS, retry: null, requestId: newRequestId() }); }

  function afterStep() {
    clear("turn"); clear("summary"); clear("bot");
    if (state.phase === "round") {
      const id = engine.pendingPlayer(state);
      arm("turn", config.TURN_MS, () => apply({ type: "act", player: id, action: defaultAction(requestFor(id)) }));
      const bot = botAgents.get(id);
      if (bot) {
        const ms = config.BOT_DELAY_MIN_MS + Math.floor(random() * (config.BOT_DELAY_MAX_MS - config.BOT_DELAY_MIN_MS + 1));
        arm("bot", ms, () => {
          const action = bot.act(requestFor(id));
          apply({ type: "act", player: id, action: engine.legalActions(state).includes(action) ? action : defaultAction(requestFor(id)) });
        });
      }
    } else if (state.phase === "round_over") {
      arm("summary", config.ROUND_SUMMARY_MS, () => apply({ type: "start_round" }));
    }
    onChange();
  }

  return {
    get state() { return state; },
    get phase() { return state ? state.phase : "lobby"; },
    get gameId() { return gameId; },
    start(seats) {
      gameId += 1;
      botAgents.clear();
      for (const s of seats) if (s.isBot) botAgents.set(s.id, bots.createBot(s.botPolicy || "threshold25", { random }));
      state = engine.createGame({ players: seats.map((s) => ({ id: s.id, name: s.name })), seed: seed(), deck });
      apply({ type: "start_round" });
    },
    act(playerId, turnNumber, action) {
      if (!state || state.phase !== "round") throw Object.assign(new Error("no decision pending"), { code: "stale_turn" });
      if (turnNumber !== state.turnNumber) throw Object.assign(new Error(`turn ${turnNumber} is over`), { code: "stale_turn" });
      if (engine.pendingPlayer(state) !== playerId) throw Object.assign(new Error("not your decision"), { code: "not_your_turn" });
      if (!engine.legalActions(state).includes(action)) throw Object.assign(new Error(`illegal action ${action}`), { code: "illegal_action" });
      apply({ type: "act", player: playerId, action });
    },
    nextRound(roundNumber) {
      if (!state || state.phase !== "round_over" || roundNumber !== state.roundNumber) return;
      apply({ type: "start_round" });
    },
    timerInfo() {
      const t = timers.turn;
      if (!t || !state || state.phase !== "round") return null;
      return { turnNumber: state.turnNumber, remainingMs: Math.max(0, t.due - now()), totalMs: config.TURN_MS };
    },
    summaryInfo() {
      const t = timers.summary;
      if (!t || !state || state.phase !== "round_over") return null;
      return { remainingMs: Math.max(0, t.due - now()), totalMs: config.ROUND_SUMMARY_MS };
    },
    dispose() { clear("turn"); clear("summary"); clear("bot"); },
  };
}

module.exports = { createRoomGame };
