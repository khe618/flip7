"use strict";
// In-process fixture whose act() always throws: decide() wraps it into an AdapterError, which
// bench/live.js treats as fatal (done rejects with code "adapter").
module.exports = { name: "throws", version: "t", act() { throw new Error("agent exploded"); } };
