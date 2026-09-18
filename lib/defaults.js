"use strict";
const { chooseTarget } = require("./bots");

// Applied when a player fails to answer (invalid twice, timeout, disconnected).
function defaultAction(request) {
  const d = request.game.decision;
  if (!d) throw new Error("no decision in request");
  if (d.type === "hit_or_stay") return "stay";
  return chooseTarget(request.game);
}

module.exports = { defaultAction };
