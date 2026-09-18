import { readName, writeName } from "./net.js";
const $ = (id) => document.getElementById(id);
let bound = false;
export function render({ toast, onNewRoom }) {
  $("nameInput").value = readName();
  if (bound) return; bound = true;
  const saveName = () => writeName($("nameInput").value.trim());
  $("quickPlayBtn").onclick = () => { saveName(); onNewRoom(true); };
  $("friendsBtn").onclick = () => { saveName(); onNewRoom(false); };
  $("joinForm").onsubmit = (e) => {
    e.preventDefault(); saveName();
    const code = $("joinCode").value.trim().toLowerCase();
    if (!/^[a-z]{4}$/.test(code)) { toast("Room codes are four letters."); return; }
    history.pushState({ room: code }, "", "/" + code); dispatchEvent(new PopStateEvent("popstate"));
  };
}
