const $ = (id) => document.getElementById(id);
let bound = false;
// The landing page only picks a mode. Names are entered on the join card once
// inside the room, and rooms are entered by link rather than by typing a code.
export function render({ onNewRoom }) {
  if (bound) return; bound = true;
  $("quickPlayBtn").onclick = () => onNewRoom(true);
  $("friendsBtn").onclick = () => onNewRoom(false);
}
