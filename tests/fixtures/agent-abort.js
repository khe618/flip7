"use strict";
let calls = 0;
module.exports = {
  name: "abort",
  version: "t",
  act(request) { return request.game.legal_actions.includes("stay") ? "stay" : request.game.legal_actions[0]; },
  start(info) { calls += 1; if (calls === 2) throw new Error("boom on second game"); },
};
