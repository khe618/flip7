"use strict";
const { observeGame } = require("./view");
const { MAX_PLAYERS } = require("./rooms");

function buildState(room, recipientId) {
  if (recipientId === null) {
    return { type: "state", room: room.code, phase: room.phase, you: null, playerCount: room.seats.size, maxPlayers: MAX_PLAYERS };
  }
  const seats = [...room.seats.values()].map((s) => ({ id: s.id, name: s.name, isBot: s.isBot, isAgent: !!s.isAgent, connected: !!s.connected }));
  const nameOf = (id) => (room.seats.get(id) || { name: id }).name;
  const g = room.game && room.game.state ? room.game : null;
  const game = g ? observeGame(g.state, recipientId) : null;
  let roundSummary = null, results = null;
  if (game && (game.phase === "round_over" || game.phase === "game_over") && game.results) {
    roundSummary = { round: game.round, rows: game.players.map((p) => ({ id: p.id, name: p.name, status: p.status, roundScore: game.results[p.id].roundScore, flip7: game.results[p.id].flip7, score: p.score })) };
  }
  if (game && game.phase === "game_over") {
    results = { winner: game.winner, winnerName: nameOf(game.winner), standings: game.players.map((p) => ({ id: p.id, name: p.name, score: p.score })).sort((a, b) => b.score - a.score) };
  }
  return { type: "state", room: room.code, phase: room.phase, you: recipientId, seats, game, gameId: g ? g.gameId : null, timer: g ? g.timerInfo() : null, summaryTimer: g ? g.summaryInfo() : null, roundSummary, results };
}

module.exports = { buildState };
