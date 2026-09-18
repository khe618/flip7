"use strict";
const http = require("node:http");
const port = Number(process.argv[2] || 0);
const mode = process.env.MODE || "ok";
let moves = 0;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ name: "httpecho", version: "t", protocol: mode === "wrong-protocol" ? "flip7-agent/0" : "flip7-agent/1" }));
      return;
    }
    if (req.url === "/move") {
      moves++;
      const { request_id, request } = JSON.parse(body);
      const legal = request.game.legal_actions;
      const send = () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ request_id, action: legal.includes("stay") ? "stay" : legal[0] })); };
      if (mode === "invalid-once" && moves === 1) { res.writeHead(500); res.end("boom"); return; }
      if (mode === "huge" && moves === 1) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ request_id, action: legal.includes("stay") ? "stay" : legal[0], pad: "x".repeat(70000) }));
        return;
      }
      if (mode === "slow") { setTimeout(send, 200); return; }
      send();
      return;
    }
    res.writeHead(200); res.end("{}");
  });
});
server.listen(port, () => process.stdout.write(`listening ${server.address().port}\n`));
