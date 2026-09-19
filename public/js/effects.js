// DOM effects for the presentation queue. `render` and `preRender` reconcile;
// step handlers (Tasks 8 and 9) animate between them.
import * as table from "./table.js";
const $ = (id) => document.getElementById(id);

export function createEffects({ ctx, showView }) {
  const handlers = { begin: {}, end: {} };
  function caption(text, tone = "") { const c = $("caption"); c.textContent = text || ""; c.className = `caption ${tone}`.trim(); $("live").textContent = text || ""; }
  // Built as a named object so Tasks 8 and 9 can add step handlers and wrap `render` before it is returned.
  const api = {
    handlers, caption,
    render(state) {
      if (!state.game) return;
      const ph = state.game.phase;
      showView("tableView");
      table.render(state, ctx);
      if (ph === "round_over") table.renderSheet(state, ctx);
      else if (ph === "game_over") { table.hideSheet(); showView("resultsView"); table.renderResults(state, ctx); }
      else table.hideSheet();
    },
    preRender(state) { table.preRender(state, ctx); },
    begin(step) { if (step.caption) caption(step.caption, step.kind === "pair" && /BUST/.test(step.caption) ? "loud" : /FLIP 7|SECOND CHANCE/.test(step.caption || "") ? "gold" : ""); (handlers.begin[step.kind] || (() => {}))(step); },
    end(step) { (handlers.end[step.kind] || (() => {}))(step); },
  };
  // Tasks 8 and 9 insert their handler definitions here, before the return.
  return api;
}
