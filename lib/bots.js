"use strict";
const cards = require("./cards");
const { unseenCounts } = require("./view");

function me(view) { return view.players.find((p) => p.id === view.you); }
function others(view) { return view.players.filter((p) => p.id !== view.you); }
function total(counts) { return Object.values(counts).reduce((a, b) => a + b, 0); }

function bustRisk(view, self) {
  if (self.second_chance) return 0;
  const unseen = unseenCounts(view);
  const n = total(unseen);
  if (n === 0) return 0;
  let dup = 0;
  for (const k of self.numbers) dup += unseen[String(k)] || 0;
  return dup / n;
}

// Expected round score after exactly one more card, from unseen counts.
function expectedAfterHit(view, self) {
  const unseen = unseenCounts(view);
  const n = total(unseen);
  const current = cards.roundScore(self, self.unique_count === 7);
  if (n === 0) return current;
  let ev = 0;
  for (const [key, count] of Object.entries(unseen)) {
    if (count === 0) continue;
    const p = count / n;
    const num = Number.parseInt(key, 10);
    if (Number.isInteger(num) && String(num) === key) {
      if (self.numbers.includes(num)) ev += p * (self.second_chance ? current : 0);
      else ev += p * cards.roundScore({ numbers: self.numbers.concat(num), modifiers: self.modifiers }, self.numbers.length + 1 === 7);
    } else if (cards.isModifier(key)) {
      ev += p * cards.roundScore({ numbers: self.numbers, modifiers: self.modifiers.concat(key) }, false);
    } else {
      ev += p * current; // action cards: treated as neutral
    }
  }
  return ev;
}

function strength(p) { return p.score + p.round_score; }

// Spec §6.2 targeting rule. Also used by lib/defaults.js.
function chooseTarget(view) {
  const d = view.decision;
  const byId = Object.fromEntries(view.players.map((p) => [p.id, p]));
  const cands = d.candidates.map((id) => byId[id]);
  const self = byId[view.you];
  const notSelf = cands.filter((p) => p.id !== view.you);
  const strongest = notSelf.length ? notSelf.reduce((a, b) => (strength(b) > strength(a) ? b : a)) : null;
  let pick;
  if (d.card === "freeze") pick = strongest || self;
  else if (d.card === "flip_three") {
    const selfOk = cands.some((p) => p.id === view.you);
    pick = selfOk && self.unique_count <= 2 ? self : strongest || self;
  } else pick = cands.reduce((a, b) => (b.score < a.score ? b : a));
  return "target:" + pick.id;
}

function hitOrStay(request, decide) {
  const view = request.game;
  if (view.decision.type === "choose_target") return chooseTarget(view);
  return decide(view, me(view)) ? "hit" : "stay";
}

const POLICIES = {
  random(request, random) {
    const legal = request.game.legal_actions;
    return legal[Math.floor(random() * legal.length)];
  },
  threshold25(request) { return hitOrStay(request, (v, self) => self.round_score < 25); },
  bustRisk25(request) { return hitOrStay(request, (v, self) => bustRisk(v, self) < 0.25); },
  evOneStep(request) { return hitOrStay(request, (v, self) => expectedAfterHit(v, self) > self.round_score); },
  adaptive(request) {
    return hitOrStay(request, (v, self) => {
      const leader = Math.max(0, ...others(v).map((p) => p.score));
      const bankNow = self.score + self.round_score;
      const leading = others(v).every((p) => strength(p) < bankNow);
      if (bankNow >= v.target_score && leading) return false;
      const threshold = Math.min(0.45, Math.max(0.10, 0.25 + 0.002 * (leader - self.score)));
      return bustRisk(v, self) < threshold;
    });
  },
};

const BOT_NAMES = Object.keys(POLICIES);

function createBot(name, { random = Math.random } = {}) {
  const policy = POLICIES[name];
  if (!policy) throw new Error(`unknown bot ${name}`);
  return { name, version: "1", act(request) { return policy(request, random); } };
}

module.exports = { bustRisk, expectedAfterHit, chooseTarget, POLICIES, BOT_NAMES, createBot };
