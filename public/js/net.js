// WebSocket lifecycle for one room. Reconnects with backoff on every close
// except the seat-takeover code (4000), and queues anything sent before open
// so quick play can fire the moment the room is entered.
const SEAT_TAKEN_OVER = 4000;

export function tokenKey(room) { return `flip7:token:${room}`; }
export function readToken(room) { try { return localStorage.getItem(tokenKey(room)); } catch { return null; } }
export function writeToken(room, token) { try { localStorage.setItem(tokenKey(room), token); } catch { /* ignore */ } }
export function clearToken(room) { try { localStorage.removeItem(tokenKey(room)); } catch { /* ignore */ } }
export function readName() { try { return localStorage.getItem("flip7:name") || ""; } catch { return ""; } }
export function writeName(name) { try { localStorage.setItem("flip7:name", name); } catch { /* ignore */ } }

export function createNet({ room, onState, onJoined, onError, onConnection }) {
  let ws = null, delay = 1000, closed = false, timer = null;
  const queue = [];   // messages sent before the socket opened
  const proto = location.protocol === "https:" ? "wss" : "ws";
  function connect() {
    ws = new WebSocket(`${proto}://${location.host}/ws?room=${room}`);
    ws.addEventListener("open", () => {
      delay = 1000; onConnection(true);
      const token = readToken(room);
      if (token) ws.send(JSON.stringify({ type: "resume", resumeToken: token }));
      for (const obj of queue.splice(0)) ws.send(JSON.stringify(obj));
    });
    ws.addEventListener("message", (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "state") onState(msg);
      else if (msg.type === "joined") { writeToken(room, msg.resumeToken); onJoined(msg); }
      else if (msg.type === "error") onError(msg);
    });
    ws.addEventListener("close", (ev) => {
      // A taken-over seat never reconnects, so it must not raise the
      // "reconnecting…" pill: that would leave the pill up forever.
      if (ev.code === SEAT_TAKEN_OVER) { onError({ code: "seat_taken_over", message: "This seat is now open in another tab." }); return; }
      onConnection(false);
      if (closed) return;
      timer = setTimeout(connect, delay);
      delay = Math.min(5000, delay * 1.5);
    });
  }
  connect();
  return {
    send(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); else queue.push(obj); },
    close() { closed = true; clearTimeout(timer); if (ws) ws.close(); },
  };
}
