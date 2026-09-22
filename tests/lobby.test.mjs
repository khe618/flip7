import test from "node:test";
import assert from "node:assert/strict";
import { agentCommand } from "../public/js/lobby.js";

// The rest of lobby.js touches the DOM (no jsdom in this repo, so it is covered
// by driving the app in a browser); the command string is the part a player
// copies verbatim, so it is pure and asserted here.
test("agentCommand builds a runnable npx line for this room", () => {
  assert.equal(
    agentCommand("https://flip7-arena.onrender.com", "abcd"),
    "npx flip7-agent https://flip7-arena.onrender.com/abcd --agent claude-code",
  );
});

test("agentCommand uses the caller's origin, so a local room does not point at production", () => {
  assert.equal(
    agentCommand("http://localhost:3000", "wxyz"),
    "npx flip7-agent http://localhost:3000/wxyz --agent claude-code",
  );
});

test("agentCommand emits exactly one room link and no double slash", () => {
  const cmd = agentCommand("https://flip7-arena.onrender.com", "abcd");
  assert.equal(cmd.split(" ").filter((w) => w.startsWith("http")).length, 1);
  assert.ok(!cmd.includes("com//"), cmd);
});
