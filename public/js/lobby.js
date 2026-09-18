const $ = (id) => document.getElementById(id);
export function render(state, ctx) {
  const list = $("seatList"); list.textContent = "";
  for (const s of state.seats) {
    const li = document.createElement("li");
    li.className = "seat" + (s.connected ? "" : " offline");
    li.innerHTML = `<span class="dot"></span><span class="name"></span>${s.isBot ? '<span class="badge">bot</span>' : ""}${s.isAgent ? '<span class="badge agent">agent</span>' : ""}${s.id === ctx.you ? '<span class="badge you">you</span>' : ""}`;
    li.querySelector(".name").textContent = s.name;
    if (s.isBot) { const b = document.createElement("button"); b.textContent = "Remove"; b.className = "link"; b.onclick = () => ctx.send({ type: "remove-bot", playerId: s.id }); li.appendChild(b); }
    list.appendChild(li);
  }
  $("addBotBtn").disabled = state.seats.length >= 6;
  $("startBtn").disabled = state.seats.length < 2;
  $("addBotBtn").onclick = () => ctx.send({ type: "add-bot" });
  $("startBtn").onclick = () => ctx.send({ type: "start-game" });
  $("copyLinkBtn").onclick = async () => { try { await navigator.clipboard.writeText(location.href); ctx.toast("Link copied"); } catch { ctx.toast(location.href); } };
}
