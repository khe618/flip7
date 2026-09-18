const $ = (id) => document.getElementById(id);
export function render(state, ctx) {
  const r = state.results;
  $("winnerLine").textContent = `${r.winnerName} wins!`;
  const ol = $("standings"); ol.textContent = "";
  for (const s of r.standings) { const li = document.createElement("li"); li.textContent = `${s.name} — ${s.score}`; ol.appendChild(li); }
  $("playAgainBtn").onclick = () => ctx.send({ type: "return-to-lobby" });
}
