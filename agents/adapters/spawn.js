"use strict";
// Process helpers shared by the spawning adapters. Nothing here goes through a shell with
// an argv array (deprecated in Node and unsafe); the one place a shell is unavoidable, a
// Windows .cmd shim, gets a command line we quote ourselves from arguments we have checked.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const SHIM_UNSAFE = /["%^&|<>()!]/;

// PATH lookup. Returns an absolute path (children run with a different cwd, so a relative PATH
// entry must be resolved here) and whether the hit is a .cmd/.bat shim.
function resolveExecutable(name, { env = process.env, platform = process.platform } = {}) {
  const win = platform === "win32";
  const shim = (p) => /\.(cmd|bat)$/i.test(p);
  const isFile = (p) => { try { if (!fs.statSync(p).isFile()) return false; if (!win) fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } };
  if (name.includes("/") || (win && name.includes("\\"))) return isFile(name) ? { path: path.resolve(name), shim: shim(name) } : null;
  const dirs = String(env.PATH || env.Path || "").split(win ? ";" : ":").filter(Boolean);
  const exts = win && path.extname(name) === "" ? String(env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean) : [""];
  for (const dir of dirs) for (const ext of exts) {
    const p = path.join(dir, name + ext);
    if (isFile(p)) {
      // realpath.native (not path.resolve) so a PATHEXT match with different case than the
      // actual filename (e.g. env PATHEXT ".CMD" hitting an on-disk "tool.cmd") still returns
      // the real on-disk casing; Windows resolves both to the same file, but callers comparing
      // the returned path string need it to match what's actually on disk. Guarded: the file
      // can still vanish (or turn into a broken symlink) between the isFile check above and
      // this call, and no other branch of this function throws, so fall back to path.resolve.
      let resolved = path.resolve(p);
      if (win) { try { resolved = fs.realpathSync.native(p); } catch { /* fall back to path.resolve above */ } }
      return { path: resolved, shim: shim(p) };
    }
  }
  return null;
}

function quoteWindowsArg(a) { return a === "" || /\s/.test(a) ? `"${a}"` : a; }

function spawnDirect(exe, args, opts = {}) {
  const win = process.platform === "win32";
  if (win && exe.shim) {
    for (const a of args) if (SHIM_UNSAFE.test(a)) throw new Error(`argument not safe for a .cmd shim: ${a}`);
    const line = [exe.path, ...args].map(quoteWindowsArg).join(" ");
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], { ...opts, windowsVerbatimArguments: true, windowsHide: true });
  }
  // detached on Unix: the child leads its own process group, so killTree can kill the group.
  return spawn(exe.path, args, { ...opts, detached: !win, windowsHide: true });
}

// Windows: child.kill() only ends the direct child (cmd.exe for a shim), never what it launched;
// taskkill /t walks the tree. taskkill is addressed by its System32 path so a stripped PATH
// cannot hide it; if it still fails to start, fall back to killing the direct child.
function killTree(child) {
  if (!child || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    const taskkill = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
    spawn(taskkill, ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true }).on("error", () => { try { child.kill("SIGKILL"); } catch { /* gone */ } });
    return;
  }
  try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* already gone */ } }
}

module.exports = { resolveExecutable, spawnDirect, killTree, quoteWindowsArg, SHIM_UNSAFE };
