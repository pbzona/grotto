import { test } from "node:test";
import assert from "node:assert/strict";
import { World, N, COVES, carveCove, type CoveKind } from "../src/world.ts";

const fnv = (a: Uint8Array) => { let h = 2166136261; for (const b of a) { h ^= b; h = Math.imul(h, 16777619); } return h >>> 0; };
const make = (kind: CoveKind, seed: number) => { const w = new World(); carveCove(w, kind, seed); return w; };

test("the classic cove at seed 0 is unchanged", () => {
  const w = make("classic", 0), d = new World(); carveCove(d);
  assert.equal(fnv(w.heights), CLASSIC_HEIGHTS);
  assert.equal(fnv(w.paint), CLASSIC_PAINT);
  assert.deepEqual(d.heights, w.heights);
});

test("presets are deterministic per seed and vary between seeds", () => {
  for (const { kind } of COVES) {
    assert.deepEqual(make(kind, 42).heights, make(kind, 42).heights, kind);
    assert.notDeepEqual(make(kind, 42).heights, make(kind, 43).heights, kind);
  }
});

test("every preset reaches the sea, has a beach and room to build", () => {
  for (const { kind } of COVES) for (let seed = 0; seed < 25; seed++) {
    const w = make(kind, seed);
    let water = 0, beach = 0, buildable = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const l = w.level(i, j);
      if (l <= 5) water++; else if (l === 6) beach++;
      if (l >= 6 && l <= 14) buildable++; // low land where houses, walks and palms go
    }
    const tag = `${kind}#${seed}`;
    assert.ok(water > N * N * 0.12 && water < N * N * 0.8, `${tag} water ${water}`);
    assert.ok(beach >= 15, `${tag} beach ${beach}`);
    assert.ok(buildable >= 200, `${tag} buildable ${buildable}`);
    // open water along the south edge so boats have somewhere to go
    let south = 0; for (let i = 0; i < N; i++) if (w.level(i, N - 1) <= 5) south++;
    assert.ok(south >= 8, `${tag} south ${south}`);
  }
});

const CLASSIC_HEIGHTS = 2898397406, CLASSIC_PAINT = 1682681541; // pinned from the pre-preset generator
