"use strict";
const crypto = require("node:crypto");

const PROMPT_VERSION = "prompt/v1";

const RULES = [
  "Rules: on your turn hit (flip one card) or stay (bank your round score). A duplicate number busts you for 0",
  "unless you hold a Second Chance. Seven distinct numbers score +15 and end the round for everyone.",
  "x2 doubles your number cards only; + modifiers add after. Freeze locks a player's line; Flip Three makes a",
  "player flip three cards; a second Second Chance must be given away. First to the target score wins.",
].join(" ");

function fmtCards(numbers, modifiers) {
  const parts = [];
  if (numbers.length) parts.push(numbers.join(", "));
  if (modifiers.length) parts.push(modifiers.join(", "));
  return parts.length ? parts.join(" | ") : "(empty)";
}

function renderRequest(request) {
  const g = request.game;
  const lines = [];
  lines.push(`Flip 7 (${PROMPT_VERSION}). Round ${g.round}, target ${g.target_score}. You are ${g.you}. Dealer: ${g.dealer}.`);
  lines.push(RULES);
  lines.push("");
  lines.push("Players:");
  for (const p of g.players) {
    const flags = [p.status, p.second_chance ? "Second Chance" : null].filter(Boolean).join(", ");
    lines.push(`- ${p.id} (${p.name})${p.id === g.you ? " [you]" : ""}: banked ${p.score}, round ${p.round_score}, ${p.unique_count} unique; cards: ${fmtCards(p.numbers, p.modifiers)}; ${flags}`);
  }
  lines.push("");
  lines.push(`Deck: ${g.deck_remaining} cards remain. Discard pile (oldest first): ${g.discard.length ? g.discard.join(", ") : "(empty)"}.`);
  if (g.resolution.length) lines.push(`Resolving: ${g.resolution.map((f) => `${f.card} from ${f.drawer}${f.target ? " to " + f.target : ""}${f.setAside.length ? " (set aside: " + f.setAside.join(", ") + ")" : ""}`).join("; ")}.`);
  if (g.history.length) {
    lines.push("Recent events:");
    for (const e of g.history.slice(-12)) {
      const rest = Object.entries(e).filter(([k]) => k !== "type" && k !== "turnNumber").map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ");
      lines.push(`- ${e.type} ${rest}`.trim());
    }
  }
  lines.push("");
  if (g.decision.type === "hit_or_stay") lines.push("Decision: hit or stay?");
  else lines.push(`Decision: Choose a target for ${g.decision.card}. Candidates: ${g.decision.candidates.join(", ")}.`);
  lines.push(`Legal actions: ${g.legal_actions.join(", ")}`);
  if (request.retry) lines.push(`Your previous reply was invalid (attempt ${request.retry.attempt}): ${request.retry.reason}. Previous reply: ${request.retry.previous}`);
  lines.push(`Reply with JSON only: {"action": "<one of the legal actions>"}. Answer within ${Math.round(request.timeout_ms / 1000)} seconds.`);
  return lines.join("\n");
}

function hashText(text) { return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16); }

module.exports = { PROMPT_VERSION, renderRequest, hashText };
