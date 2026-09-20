"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs, parseRoom, UsageError, DEFAULT_URL } = require("../agents/cli");

const D = "ws://localhost:3000";

test("parseRoom: links set server and room; codes use the default", () => {
  assert.deepEqual(parseRoom("https://flip7-arena.onrender.com/abcd", D), { url: "wss://flip7-arena.onrender.com", room: "abcd" });
  assert.deepEqual(parseRoom("https://flip7-arena.onrender.com/abcd/", D), { url: "wss://flip7-arena.onrender.com", room: "abcd" });
  assert.deepEqual(parseRoom("https://flip7-arena.onrender.com/abcd?x=1", D), { url: "wss://flip7-arena.onrender.com", room: "abcd" });
  assert.deepEqual(parseRoom("http://127.0.0.1:3111/wxyz", D), { url: "ws://127.0.0.1:3111", room: "wxyz" });
  assert.deepEqual(parseRoom("ws://localhost:3000/wxyz", D), { url: "ws://localhost:3000", room: "wxyz" });
  assert.deepEqual(parseRoom("abcd", D), { url: D, room: "abcd" });
  assert.deepEqual(parseRoom("abcd", DEFAULT_URL), { url: "wss://flip7-arena.onrender.com", room: "abcd" });
});

test("parseRoom: rejects bad codes, bad links, and links without a code", () => {
  for (const bad of ["abc", "ABCD", "abcde", "", "not a url", "https://flip7-arena.onrender.com/", "https://flip7-arena.onrender.com/how-to-play", "ftp://x/abcd"]) {
    assert.throws(() => parseRoom(bad, D), UsageError, bad);
  }
});

test("parseArgs: positional room, --room alias, --url only applies to bare codes and is validated", () => {
  assert.deepEqual(parseArgs(["abcd", "--agent", "bot:threshold25"], { defaultUrl: D }), { url: D, room: "abcd", spec: "bot:threshold25", name: null, quiet: false, help: false, version: false });
  assert.equal(parseArgs(["--room", "abcd", "--agent", "x"], { defaultUrl: D }).room, "abcd");
  assert.equal(parseArgs(["abcd", "--agent", "x", "--url", "ws://h:1"], { defaultUrl: D }).url, "ws://h:1");
  assert.equal(parseArgs(["abcd", "--agent", "x", "--url", "https://h:1/"], { defaultUrl: D }).url, "wss://h:1", "http(s) is converted and trailing slash dropped");
  assert.equal(parseArgs(["http://h:2/abcd", "--agent", "x", "--url", "ws://h:1"], { defaultUrl: D }).url, "ws://h:2", "a link wins over --url");
  assert.equal(parseArgs(["abcd", "--agent", "x", "--name", "Bob", "--quiet"], { defaultUrl: D }).name, "Bob");
  assert.equal(parseArgs(["abcd", "--agent", "x", "--quiet"], { defaultUrl: D }).quiet, true);
  assert.throws(() => parseArgs(["abcd", "--agent", "x", "--url", "nonsense"], { defaultUrl: D }), UsageError);
  assert.throws(() => parseArgs(["abcd", "--agent", "x", "--url", "ftp://h"], { defaultUrl: D }), UsageError);
});

test("parseArgs: --model folds into the claude-code spec and conflicts are errors", () => {
  assert.equal(parseArgs(["abcd", "--agent", "claude-code", "--model", "sonnet"], { defaultUrl: D }).spec, "claude-code:sonnet");
  assert.equal(parseArgs(["abcd", "--agent", "claude-code:sonnet", "--model", "sonnet"], { defaultUrl: D }).spec, "claude-code:sonnet");
  assert.throws(() => parseArgs(["abcd", "--agent", "claude-code:opus", "--model", "sonnet"], { defaultUrl: D }), UsageError);
  assert.throws(() => parseArgs(["abcd", "--agent", "bot:x", "--model", "sonnet"], { defaultUrl: D }), UsageError);
});

test("parseArgs: usage errors and help/version", () => {
  assert.throws(() => parseArgs([], { defaultUrl: D }), UsageError);
  assert.throws(() => parseArgs(["abcd"], { defaultUrl: D }), /--agent/);
  assert.throws(() => parseArgs(["--agent", "x"], { defaultUrl: D }), /room/);
  assert.throws(() => parseArgs(["abcd", "--agent"], { defaultUrl: D }), /needs a value/);
  assert.throws(() => parseArgs(["abcd", "--agent", "x", "--bogus"], { defaultUrl: D }), /unknown option --bogus/);
  assert.throws(() => parseArgs(["abcd", "efgh", "--agent", "x"], { defaultUrl: D }), /unexpected argument/);
  assert.equal(parseArgs(["--help"], { defaultUrl: D }).help, true);
  assert.equal(parseArgs(["--version"], { defaultUrl: D }).version, true);
});
