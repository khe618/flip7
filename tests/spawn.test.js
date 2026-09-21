"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveExecutable, spawnDirect, killTree, quoteWindowsArg } = require("../agents/adapters/spawn");

const win = process.platform === "win32";

// Every wait on a child has a deadline so a regression fails instead of hanging the suite.
function closed(child, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } reject(new Error(`child did not close within ${ms} ms`)); }, ms);
    child.on("close", (code) => { clearTimeout(t); resolve(code); });
  });
}

test("resolveExecutable finds node itself on the real PATH, absolute, and returns null for a missing name", () => {
  const found = resolveExecutable(win ? "node.exe" : "node");
  assert.ok(found && fs.existsSync(found.path));
  assert.ok(path.isAbsolute(found.path));
  assert.equal(found.shim, false);
  assert.equal(resolveExecutable("flip7-definitely-not-installed-xyz"), null);
  const byPath = resolveExecutable(process.execPath);
  assert.equal(byPath.path, process.execPath);
});

test("resolveExecutable honours PATHEXT on Windows and flags .cmd shims", { skip: !win && "Windows-only lookup semantics" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flip7-spawn-"));
  fs.writeFileSync(path.join(dir, "tool.cmd"), "@echo off\r\n");
  const env = { PATH: `relative-dir;${dir}`, PATHEXT: ".EXE;.CMD" };
  const r = resolveExecutable("tool", { env, platform: "win32" });
  assert.deepEqual(r, { path: path.join(dir, "tool.cmd"), shim: true });
  assert.equal(resolveExecutable("tool", { env: { PATH: dir, PATHEXT: ".EXE" }, platform: "win32" }), null, "extension list is respected");
  assert.equal(resolveExecutable(path.join(dir, "tool.cmd"), { env: {}, platform: "win32" }).shim, true, "an explicit path is accepted without a PATH search");
});

test("quoteWindowsArg quotes only when needed", () => {
  assert.equal(quoteWindowsArg("plain"), "plain");
  assert.equal(quoteWindowsArg("two words"), "\"two words\"");
  assert.equal(quoteWindowsArg(""), "\"\"");
});

test("spawnDirect runs a direct executable with spaces and empty arguments intact", async () => {
  const node = resolveExecutable(process.execPath);
  const child = spawnDirect(node, ["-e", "process.stdout.write(process.argv.slice(1).join('|'))", "a b", ""], { stdio: ["ignore", "pipe", "ignore"] });
  let out = ""; child.stdout.on("data", (b) => { out += b; });
  await closed(child);
  assert.equal(out, "a b|");
});

test("spawnDirect refuses shim-unsafe arguments", { skip: !win && "the shim branch only exists on Windows" }, () => {
  assert.throws(() => spawnDirect({ path: "x.cmd", shim: true }, ["say \"hi\""]), /not safe/);
  assert.throws(() => spawnDirect({ path: "x.cmd", shim: true }, ["a&b"]), /not safe/);
});

test("killTree ends a sleeping child and its descendants", async () => {
  const node = resolveExecutable(process.execPath);
  // The child spawns a grandchild that sleeps; both must be gone after killTree.
  const script = "const {spawn}=require('child_process');const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.stdout.write(String(g.pid));setInterval(()=>{},1000)";
  const child = spawnDirect(node, ["-e", script], { stdio: ["ignore", "pipe", "ignore"] });
  const grandPid = Number(await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("no grandchild pid")), 5000); child.stdout.once("data", (b) => { clearTimeout(t); resolve(String(b)); }); }));
  killTree(child);
  await closed(child);
  const deadline = Date.now() + 3000;
  let alive = true;
  while (alive && Date.now() < deadline) { try { process.kill(grandPid, 0); await new Promise((r) => setTimeout(r, 50)); } catch { alive = false; } }
  assert.equal(alive, false, "grandchild must be killed with the tree");
});
