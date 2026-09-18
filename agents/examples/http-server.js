"use strict";
// HTTP example: `node agents/examples/http-server.js 8080` then
// `node bench/run.js --agent http://localhost:8080`
const http = require("node:http");
const port = Number(process.argv[2] || 8080);
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/") return res.end(JSON.stringify({ name: "example-http", version: "1", protocol: "flip7-agent/1" }));
    if (req.url !== "/move") return res.end("{}");
    const { request_id, request } = JSON.parse(body);
    const g = request.game;
    const me = g.players.find((p) => p.id === g.you);
    const action = g.decision.type === "choose_target" ? g.legal_actions[0] : me.round_score < 20 ? "hit" : "stay";
    res.end(JSON.stringify({ request_id, action }));
  });
}).listen(port, () => console.log(`example agent on http://localhost:${port}`));
