"use strict";
const { fnv1a } = require("../lib/rng");

const DEFS = {
  standard: { table: 4, count: 50, base: "standard" },
  smoke: { table: 4, count: 3, base: "smoke" },
  fresh: { table: 4, count: 50, base: null },
};

function getSuite(name, { seeds, table, seedBase } = {}) {
  const def = DEFS[name];
  if (!def) throw new Error(`unknown suite "${name}" (standard, fresh, smoke)`);
  const base = def.base || String(seedBase || Date.now());
  const count = seeds || def.count;
  const size = table || def.table;
  if (size < 2 || size > 6) throw new Error("table must be 2..6");
  const list = [];
  for (let i = 0; i < count; i++) list.push(fnv1a(`${base}:${i}`));
  return { name, table: size, seeds: list, rotations: size, seed_base: base };
}

module.exports = { getSuite, SUITE_NAMES: Object.keys(DEFS) };
