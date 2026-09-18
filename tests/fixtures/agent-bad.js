"use strict";
let calls = 0;
module.exports = {
  name: "bad", version: "t",
  act(request) {
    calls++;
    if (process.env.BAD_MODE === "always") return "nope";
    if (process.env.BAD_MODE === "hang") return new Promise(() => {});
    if (process.env.BAD_MODE === "late") return new Promise((resolve) => setTimeout(() => resolve("hit"), 150));
    return calls === 1 ? "nope" : (request.game.legal_actions.includes("stay") ? "stay" : request.game.legal_actions[0]);
  },
};
