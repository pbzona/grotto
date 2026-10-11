import { test } from "node:test";
import assert from "node:assert/strict";
import { World, N, WATER_Y, carveCove } from "../src/world.ts";
import { planVoyages, poseAt, navGrid, isFree, Fleet } from "../src/voyages.ts";

/** Land everywhere but a small basin, and a channel from it out to the south edge. */
function basin() {
  const w = new World();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const water = (i >= 8 && i <= 14 && j >= 8 && j <= 14) || (i >= 9 && i <= 13 && j >= 14);
    w.setLevel(i, j, water ? 2 : 10);
  }
  // open sea across the south
  for (let j = 36; j < N; j++) for (let i = 0; i < N; i++) w.setLevel(i, j, 2);
  return w;
}
const boat = (w: World, type: "rowboat" | "sloop", x: number, z: number, id = type) => w.props.set(id, { id, type, x, z, rot: 0, seed: 0.42 });
function bridge(w: World, y: number, style: "deck" | "rope" = "deck") {
  w.nodes.set("a", { id: "a", x: 7, z: 15, y, pad: 0 }); w.nodes.set("b", { id: "b", x: 16, z: 15, y, pad: 0 });
  w.edges.set("e", { id: "e", a: "a", b: "b", width: 1.1, style, rail: false });
}

test("a boat is home at night, out at midday, and its route stays in open water", () => {
  const w = basin(); boat(w, "rowboat", 11.5, 11.5);
  const v = planVoyages(w).get("rowboat")!;
  assert.ok(v.path, "has a way out");
  for (const h of [0, 3, 5.5, 19.6, 21, 23.9]) assert.ok(poseAt(v, h).home, `home at ${h}`);
  const noon = poseAt(v, 12);
  assert.ok(!noon.home && Math.hypot(noon.x - 11.5, noon.z - 11.5) > 5, "out at noon");
  const g = navGrid(w, false, "rowboat");
  for (let h = v.depart; h < v.back + v.travel; h += 0.02) {
    const p = poseAt(v, h);
    if (Math.hypot(p.x - 11.5, p.z - 11.5) > 1.5) assert.ok(isFree(g, p.x, p.z), `clear at ${h.toFixed(2)}: ${p.x.toFixed(2)},${p.z.toFixed(2)}`);
  }
  // continuous: no jumps while the dial turns
  let last = poseAt(v, 0);
  for (let h = 0; h < 24; h += 0.01) { const p = poseAt(v, h); assert.ok(Math.hypot(p.x - last.x, p.z - last.z) < 0.5); last = p; }
  assert.deepEqual(planVoyages(w).get("rowboat")!.path, v.path, "deterministic");
});

test("low walkways close a channel; rowboats pass under a high one, sloops never", () => {
  const w = basin(); boat(w, "rowboat", 11.5, 11.5); boat(w, "sloop", 11.5, 11.5);
  // one at a time so they do not block each other's mooring
  const plan = (type: string) => { const c = basin(); const p = w.props.get(type)!; c.props.set(p.id, p); for (const [k, n] of w.nodes) c.nodes.set(k, n); for (const [k, e] of w.edges) c.edges.set(k, e); return planVoyages(c).get(type)!; };
  assert.ok(plan("rowboat").path && plan("sloop").path, "open channel");
  bridge(w, WATER_Y + 0.75);
  assert.equal(plan("rowboat").path, null, "low deck blocks a rowboat");
  assert.equal(plan("sloop").path, null);
  assert.ok(poseAt(plan("rowboat"), 12).home, "a trapped boat stays moored");
  bridge(w, WATER_Y + 1.1);
  assert.ok(plan("rowboat").path, "rowboat slips under a high deck");
  assert.equal(plan("sloop").path, null, "sloops never go under a deck");
  bridge(w, WATER_Y + 2.5);
  assert.equal(plan("rowboat").path, null, "tall decks are braced");
  bridge(w, WATER_Y + 2.5, "rope");
  assert.ok(plan("rowboat").path, "rope bridges have no bracing");
});

test("boats in the classic cove all get out and keep apart", () => {
  const w = new World(); carveCove(w, "classic", 0);
  boat(w, "rowboat", 24, 33, "r1"); boat(w, "rowboat", 27, 33, "r2"); boat(w, "sloop", 25, 38, "s1");
  const vs = planVoyages(w);
  const out = [...vs.values()].map(v => poseAt(v, 12.5));
  for (const [i, v] of [...vs.values()].entries()) assert.ok(v.path, `${v.id} out`), assert.ok(!out[i].home);
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) assert.ok(Math.hypot(out[i].x - out[j].x, out[i].z - out[j].z) > 3);
});

test("a boat whose spot is built over shrinks away and comes back home", () => {
  const w = basin(); boat(w, "rowboat", 11.5, 11.5);
  const f = new Fleet(); f.replan(w);
  const a = f.pose("rowboat", 12, 0.1)!;
  assert.ok(!a.home && a.vis === 1);
  bridge(w, WATER_Y + 0.75); f.replan(w);
  const b = f.pose("rowboat", 12, 0.1)!;
  assert.ok(b.vis < 1 && Math.hypot(b.x - a.x, b.z - a.z) < 1, "shrinks where it was");
  let c = b; for (let k = 0; k < 20; k++) c = f.pose("rowboat", 12, 0.1)!;
  assert.ok(c.home && c.vis === 1, "back at the mooring");
});
