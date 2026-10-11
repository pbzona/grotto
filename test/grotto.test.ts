import test from "node:test";
import assert from "node:assert/strict";
import { grottoDims, grottoCeiling, grottoWall, GROTTO_DECK, GROTTO_OPTS } from "../src/world.ts";

// a villager stands about 1.0 tall; a rowboat with a rower sits 1.1 over the water; a sloop's mast tops out near 4.5
for (const size of GROTTO_OPTS.size) for (const arch of GROTTO_OPTS.arch) test(`grotto ${size}/${arch} fits its boat and a standing person`, () => {
  const g = grottoDims({ seed: 0.3, opts: { size, arch } });
  const wall = grottoWall(g, GROTTO_DECK) - 0.08, width = wall - g.chan;
  assert.ok(width >= 0.8, `dock ${width.toFixed(2)} wide`);
  for (let x = g.chan; x <= g.chan + width * 0.6; x += 0.05) assert.ok(grottoCeiling(g, x) - GROTTO_DECK >= 1.3, `headroom ${(grottoCeiling(g, x) - GROTTO_DECK).toFixed(2)} at ${x.toFixed(2)}`);
  for (let x = 0; x <= g.chan; x += 0.05) assert.ok(grottoCeiling(g, x) >= 1.6, `channel clearance at ${x.toFixed(2)}`);
  if (size === 2) for (let x = 0; x <= 0.6; x += 0.05) assert.ok(grottoCeiling(g, x) >= 4.9, `mast clearance ${grottoCeiling(g, x).toFixed(2)}`);
  assert.ok(Math.abs(grottoWall(g, 0) - g.W) < 1e-6 && Math.abs(grottoCeiling(g, 0) - g.H) < 1e-6);
});
