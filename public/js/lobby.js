const $ = (id) => document.getElementById(id);

// The npx command a player runs to seat an agent at THIS room. Kept pure (and
// tested) because the room link is the one part a player cannot guess: a wrong
// origin or code sends their agent to someone else's table.
export function agentCommand(origin, room) {
  return `npx flip7-agent ${origin}/${room} --agent claude-code`;
}

export function render(state, ctx) {
  const list = $("seatList"); list.textContent = "";
  for (const s of state.seats) {
    const li = document.createElement("li");
    li.className = "seat" + (s.connected ? "" : " offline");
    li.innerHTML = `<span class="dot"></span><span class="name"></span>${s.isBot ? '<span class="badge bot">bot</span>' : ""}${s.isAgent ? '<span class="badge agent">agent</span>' : ""}${s.id === ctx.you ? '<span class="badge you">you</span>' : ""}`;
    li.querySelector(".name").textContent = s.name;
    if (s.isBot) { const b = document.createElement("button"); b.textContent = "Remove"; b.className = "link"; b.onclick = () => ctx.send({ type: "remove-bot", playerId: s.id }); li.appendChild(b); }
    list.appendChild(li);
  }
  for (let i = state.seats.length; i < 6; i++) {
    const li = document.createElement("li"); li.className = "seat open"; li.textContent = "Open seat"; list.appendChild(li);
  }
  $("addBotBtn").disabled = state.seats.length >= 6;
  $("startBtn").disabled = state.seats.length < 2;
  $("addBotBtn").onclick = () => ctx.send({ type: "add-bot" });
  $("startBtn").onclick = () => ctx.send({ type: "start-game" });
  $("copyLinkBtn").onclick = ctx.copyLink;

  // Re-rendered on every broadcast; <details> keeps its own open state, so the
  // panel does not collapse under a player while they are reading it.
  const cmd = agentCommand(location.origin, ctx.room);
  $("agentCmd").textContent = cmd;
  $("copyCmdBtn").onclick = async () => {
    try { await navigator.clipboard.writeText(cmd); ctx.toast("Command copied"); }
    catch { ctx.toast(cmd); }
  };
}
