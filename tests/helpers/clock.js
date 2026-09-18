"use strict";

// Deterministic clock for lib/ factories. advance(ms) runs due timers in due-time
// order, so a callback that arms another timer inside the window also fires.
function createClock(start = 0) {
  let now = start;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { due: now + Math.max(0, ms), seq: id, fn });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    pending: () => timers.size,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const t of timers.values()) {
          if (t.due <= end && (next === null || t.due < next.due || (t.due === next.due && t.seq < next.seq))) next = t;
        }
        if (!next) break;
        timers.delete(next.seq);
        now = Math.max(now, next.due);
        next.fn();
      }
      now = end;
    },
  };
}

module.exports = { createClock };
