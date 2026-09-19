// The presentation queue (spec §3.1, §3.3, §3.5). No DOM here: effects are
// injected so node tests can drive the queue with a fake clock.
import { newEvents, planSteps, compress, totalMs, BUDGET_MS, BARRIER_CAP_MS } from "./sequence.js";

const defaultClock = { now: () => performance.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) };
const noop = () => {};
const defaultNameOf = (state) => { const m = new Map((state.game?.players || []).map((p) => [p.id, p.name])); return (id) => m.get(id) || id; };

export function createPresenter({ effects, clock = defaultClock, reducedMotion = false, nameOf = defaultNameOf }) {
  const fx = { preRender: noop, begin: noop, end: noop, caption: noop, ...effects };
  let cursor = null, gameId = null, phase = null, latest = null;
  let queue = [], busy = false, gen = 0;
  let active = null;               // { step, resolve, timer } while a step is waiting
  const deadlines = new Set();     // clock timer ids for barrier caps

  // A cancellable wait: cut(ms) shortens the remaining wait to at most `ms`.
  function wait(step, ms) {
    return new Promise((resolve) => {
      const done = () => { if (active && active.step === step) { clock.clearTimeout(active.timer); active = null; } resolve(); };
      active = { step, resolve: done, timer: clock.setTimeout(done, ms) };
    });
  }
  function cutActive(afterMs) {
    if (!active) return;
    clock.clearTimeout(active.timer);
    const a = active; a.timer = clock.setTimeout(a.resolve, afterMs);
  }
  function flush() {
    queue = []; gen += 1; busy = false;
    if (active) { clock.clearTimeout(active.timer); active = null; }
    for (const id of deadlines) clock.clearTimeout(id); deadlines.clear();
  }
  // Barrier cap: when it fires and the barrier is still queued, drop everything
  // ahead of it and cut the active wait so the barrier runs now.
  function armCap(barrier) {
    const id = clock.setTimeout(() => {
      deadlines.delete(id);
      const idx = queue.indexOf(barrier);
      if (idx < 0) return;
      queue.splice(0, idx);
      cutActive(0);
    }, BARRIER_CAP_MS);
    deadlines.add(id);
  }

  async function pump() {
    busy = true;
    const myGen = gen;
    while (queue.length && myGen === gen) {
      const step = queue.shift();
      fx.begin(step);
      if (step.ms > 0) await wait(step, step.ms);
      if (myGen !== gen) return;
      fx.end(step);
      if (step.kind === "barrier") {
        fx.render(step.state);
        if (queue.some((s) => s.kind === "barrier")) fx.preRender(latest);   // an older barrier never enables input
      }
    }
    if (myGen === gen) busy = false;
  }

  return {
    enqueue(state) {
      const prevPhase = phase; phase = state.phase;
      if (!state.game || state.phase === "lobby") { flush(); cursor = null; gameId = state.gameId ?? null; latest = state; fx.render(state); return; }
      if (state.gameId !== gameId) { flush(); gameId = state.gameId; cursor = prevPhase === "lobby" ? 0 : null; }
      latest = state;
      const hadCursor = cursor !== null;
      const r = newEvents(cursor, state.game);
      cursor = r.cursor;
      if (r.reset) { flush(); fx.render(state); if (hadCursor) fx.caption("Catching up…"); return; }
      const steps = planSteps(r.events, state.game, { you: state.you, reducedMotion, nameOf: nameOf(state) });
      const barrier = steps[steps.length - 1];
      barrier.state = state; barrier.arrivedAt = clock.now();
      if (active && active.step.kind === "sheet" && steps.some((s) => s.kind === "round-start")) cutActive(300);
      queue.push(...steps);
      armCap(barrier);
      fx.preRender(state);
      if (totalMs(queue) > BUDGET_MS) queue = compress(queue);
      if (!busy) pump();
    },
    reset() { flush(); cursor = null; gameId = null; phase = null; latest = null; },
    isIdle() { return !busy && queue.length === 0; },
  };
}
