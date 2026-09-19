import test from "node:test";
import assert from "node:assert/strict";
import { createPresenter } from "../public/js/present.js";

function clock() {
  let now = 0, seq = 0; const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { due: now + ms, fn, id }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const t of timers.values()) if (t.due <= end && (!next || t.due < next.due || (t.due === next.due && t.id < next.id))) next = t;
        if (!next) break;
        timers.delete(next.id); now = Math.max(now, next.due); next.fn();
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); // let the pump continue
      }
      now = end;
      await Promise.resolve(); await Promise.resolve();
    },
  };
}

function fx() {
  const log = [];
  return { log,
    render: (s) => log.push(["render", s.game ? s.game.turnNumber : s.phase]),
    preRender: (s) => log.push(["pre", s.game.turnNumber]),
    begin: (st) => log.push(["begin", st.kind]),
    end: (st) => log.push(["end", st.kind]),
    caption: (t) => log.push(["caption", t]),
  };
}

const ev = (type, fields = {}) => ({ type, turnNumber: 1, ...fields });
const snap = ({ phase = "playing", gameId = 1, turnNumber = 1, history = [], history_start = 0, you = "a" } = {}) =>
  ({ type: "state", phase, you, gameId, game: phase === "lobby" ? null : { phase: "round", turnNumber, history, history_start, players: [{ id: "a", name: "Ann" }, { id: "b", name: "Bo" }] } });

test("first snapshot renders immediately with no steps", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  p.enqueue(snap({ history: [ev("round_started"), ev("dealt", { player: "a", card: 5 })] }));
  assert.deepEqual(e.log, [["render", 1]]);
  assert.ok(p.isIdle());
});

test("a later snapshot pre-renders at once and renders only after its steps have played", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  const h = [ev("round_started"), ev("dealt", { player: "a", card: 5 })];
  p.enqueue(snap({ history: h }));
  e.log.length = 0;
  p.enqueue(snap({ turnNumber: 2, history: [...h, ev("hit", { player: "a", card: 7 })] }));
  assert.deepEqual(e.log[0], ["pre", 2]);
  assert.deepEqual(e.log[1], ["begin", "press-deck"]);
  assert.ok(!e.log.some((l) => l[0] === "render"));
  await c.advance(879);
  assert.ok(!e.log.some((l) => l[0] === "render"), "not yet: 880 ms of steps");
  await c.advance(1);
  assert.deepEqual(e.log.at(-1), ["render", 2]);
  assert.deepEqual(e.log.filter((l) => l[0] === "begin").map((l) => l[1]), ["press-deck", "travel", "flip", "rest", "sort", "barrier"]);
  assert.ok(p.isIdle());
});

test("lobby to playing animates the first deal (cursor starts at 0)", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  p.enqueue(snap({ phase: "lobby", gameId: null }));
  assert.deepEqual(e.log, [["render", "lobby"]]);
  e.log.length = 0;
  p.enqueue(snap({ gameId: 1, history: [ev("round_started", { roundNumber: 1, dealer: "a" }), ev("dealt", { player: "a", card: 5 }), ev("dealt", { player: "b", card: 9 })] }));
  assert.ok(e.log.some((l) => l[0] === "begin" && l[1] === "travel"), "the deal travels");
  await c.advance(5000);
  assert.deepEqual(e.log.at(-1), ["render", 1]);
});

test("a repeated snapshot enqueues nothing new", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  const s = snap({ history: [ev("round_started")] });
  p.enqueue(s); e.log.length = 0;
  p.enqueue(s);
  assert.deepEqual(e.log, [["pre", 1], ["begin", "barrier"], ["end", "barrier"], ["render", 1]]);
});

test("a window that slid past the cursor resets and captions Catching up", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  p.enqueue(snap({ history: [ev("round_started")] })); e.log.length = 0;
  p.enqueue(snap({ turnNumber: 30, history: [ev("hit", { player: "a", card: 1 })], history_start: 50 }));
  assert.deepEqual(e.log, [["render", 30], ["caption", "Catching up…"]]);
});

test("a new gameId mid-game flushes the queue and resets the cursor", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  const h = [ev("round_started")];
  p.enqueue(snap({ history: h }));
  p.enqueue(snap({ turnNumber: 2, history: [...h, ev("hit", { player: "a", card: 7 })] }));
  await c.advance(100);
  e.log.length = 0;
  p.enqueue(snap({ gameId: 2, turnNumber: 1, history: [ev("round_started")] }));
  assert.deepEqual(e.log, [["render", 1]]);
  await c.advance(2000);
  assert.ok(!e.log.some((l) => l[0] === "end" && l[1] !== "barrier"), "no step from the old game finishes after the flush");
});

test("queued playtime over the budget is compressed", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  const h = [ev("round_started")];
  p.enqueue(snap({ history: h }));
  const hits = [ev("hit", { player: "a", card: "+4" }), ev("hit", { player: "b", card: "+2" }), ev("hit", { player: "a", card: "x2" }), ev("hit", { player: "b", card: 3 })]; // 4 x 880 + 3 x 220 = 4180 ms
  p.enqueue(snap({ turnNumber: 5, history: [...h, ...hits] }));
  await c.advance(10000);
  const begun = e.log.filter((l) => l[0] === "begin").map((l) => l[1]);
  assert.ok(!begun.includes("score-roll"), "cosmetic steps were dropped");
  assert.deepEqual(e.log.at(-1), ["render", 5]);
});

test("a barrier runs at the 4 s cap even while an earlier step is mid-wait", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  const h = [ev("round_started")];
  p.enqueue(snap({ history: h }));
  const many = Array.from({ length: 16 }, (_, i) => ev("hit", { player: i % 2 ? "a" : "b", card: i % 13 }));
  p.enqueue(snap({ turnNumber: 17, history: [...h, ...many] })); // compressed: 16 x (120 + 150) = 4320 ms, past the cap
  await c.advance(3999);
  assert.ok(!e.log.some((l) => l[0] === "render" && l[1] === 17), "not before the cap");
  await c.advance(1);
  assert.ok(e.log.some((l) => l[0] === "render" && l[1] === 17), "rendered exactly at the cap");
  assert.equal(c.now(), 4000);
});

test("an older barrier renders its snapshot but hands control back to the latest one (no stale input window)", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  const h = [ev("round_started")];
  p.enqueue(snap({ history: h }));
  const h2 = [...h, ev("hit", { player: "b", card: 7 })];
  p.enqueue(snap({ turnNumber: 2, history: h2 }));
  p.enqueue(snap({ turnNumber: 3, history: [...h2, ev("hit", { player: "a", card: 9 })] }));
  await c.advance(880);
  const i = e.log.findIndex((l) => l[0] === "render" && l[1] === 2);
  assert.ok(i > 0, "turn 2 barrier rendered");
  assert.deepEqual(e.log[i + 1], ["pre", 3], "immediately re-disabled by the latest snapshot's pre-render");
  await c.advance(880);
  assert.deepEqual(e.log.at(-1), ["render", 3]);
});

test("a new round arriving while the sheet is up cuts the sheet wait to 300 ms", async () => {
  const e = fx(), c = clock();
  const p = createPresenter({ effects: e, clock: c });
  const h = [ev("round_started")];
  p.enqueue(snap({ history: h }));
  p.enqueue(snap({ turnNumber: 5, history: [...h, ev("stay", { player: "a" }), ev("round_ended", { results: {} })] })); // banked-stamp 260 + sheet 900
  await c.advance(300); // 40 ms into the sheet
  assert.deepEqual(e.log.at(-1), ["begin", "sheet"]);
  p.enqueue(snap({ turnNumber: 6, history: [ev("round_started", { roundNumber: 2, dealer: "b" }), ev("dealt", { player: "a", card: 4 })], history_start: 3 }));
  await c.advance(300);
  assert.ok(e.log.some((l) => l[0] === "end" && l[1] === "sheet"), "sheet ended 300 ms after the new round arrived, not 860 ms");
});
