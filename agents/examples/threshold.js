"use strict";
// In-process example: `node bench/run.js --agent file:./agents/examples/threshold.js`
module.exports = {
  name: "example-threshold",
  version: "1",
  act(request) {
    const g = request.game;
    if (g.decision.type === "choose_target") return g.legal_actions[0];
    const me = g.players.find((p) => p.id === g.you);
    return me.round_score < 20 ? "hit" : "stay";
  },
};
