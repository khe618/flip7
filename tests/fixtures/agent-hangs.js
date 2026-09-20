"use strict";
// In-process fixture whose act() never resolves, so decide() always times out.
module.exports = { name: "hangs", version: "t", act() { return new Promise(() => {}); } };
