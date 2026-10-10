import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/world.ts";
import { Villagers, headcount, route, MAX_VILLAGERS, type Home } from "../src/villagers.ts";

function line(w: World, ids: string[], y = 1) {
  ids.forEach((id, i) => w.nodes.set(id, { id, x: 10 + i * 2, z: 10, y, pad: 0 }));
  for (let i = 1; i < ids.length; i++) w.edges.set(`e${ids[i - 1]}${ids[i]}`, { id: `e${ids[i - 1]}${ids[i]}`, a: ids[i - 1], b: ids[i], width: 1.1, style: "deck", rail: false });
}
const run = (v: Villagers, w: World, secs: number, dt = 0.1) => { for (let t = 0; t < secs; t += dt) v.update(w, dt); };
const onDeck = (w: World, x: number, z: number) => [...w.edges.values()].some(e => {
  const a = w.nodes.get(e.a)!, b = w.nodes.get(e.b)!;
  const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t) <= e.width / 2 + 1e-6;
});

test("headcount: one each, a second for big houses, capped", () => {
  const homes: Home[] = [{ house: "a", node: "n", seed: 1, size: 1 }, { house: "b", node: "n", seed: 2, size: 2 }];
  assert.deepEqual([...headcount(homes)].sort(), [["a", 1], ["b", 2]]);
  const many = Array.from({ length: 20 }, (_, i) => ({ house: `h${String(i).padStart(2, "0")}`, node: "n", seed: i, size: 2 }));
  const c = headcount(many);
  assert.equal([...c.values()].reduce((s, n) => s + n, 0), MAX_VILLAGERS);
});

test("route follows the graph and fails across a gap", () => {
  const w = new World(); line(w, ["a", "b", "c", "d"]);
  assert.deepEqual(route(w, "a", "d"), ["b", "c", "d"]);
  w.edges.delete("ebc");
  assert.equal(route(w, "a", "d"), null);
});

test("villagers appear at the door, stay on the walkways and their component", () => {
  const w = new World(); line(w, ["a", "b", "c", "d"]); line(w, ["x", "y"]); w.nodes.get("x")!.z = 30; w.nodes.get("y")!.z = 30;
  const v = new Villagers();
  v.sync(w, [{ house: "h", node: "a", seed: 3, size: 2 }]);
  assert.equal(v.people.length, 2);
  assert.ok(v.people.every(p => p.x === 10 && p.z === 10 && p.vis === 0));
  let walked = false;
  for (let i = 0; i < 1200; i++) {
    v.update(w, 0.1);
    for (const p of v.people) {
      if (p.vis > 0) assert.ok(onDeck(w, p.x, p.z), `off deck at ${p.x},${p.z}`);
      assert.ok(p.z < 20, "wandered to an unconnected walkway");
      if (p.phase === "walk") walked = true;
    }
  }
  assert.ok(walked);
});

test("a deleted house's villagers fade away; a cut walkway sends them home", () => {
  const w = new World(); line(w, ["a", "b", "c", "d"]);
  const v = new Villagers();
  const home = [{ house: "h", node: "a", seed: 5, size: 1 }];
  v.sync(w, home); run(v, w, 20);
  // cut every edge: whoever is out fades and comes back at the door, never mid-air
  w.edges.clear(); w.edges.set("eab", { id: "eab", a: "a", b: "b", width: 1.1, style: "deck", rail: false });
  v.sync(w, home); run(v, w, 30);
  for (const p of v.people) if (p.vis > 0) assert.ok(onDeck(w, p.x, p.z));
  v.sync(w, []); run(v, w, 3);
  assert.equal(v.people.length, 0);
});

test("resync is stable: same houses keep the same people", () => {
  const w = new World(); line(w, ["a", "b", "c"]);
  const v = new Villagers(), home = [{ house: "h", node: "a", seed: 9, size: 1 }];
  v.sync(w, home); run(v, w, 10);
  const before = v.people[0];
  v.sync(w, home);
  assert.equal(v.people.length, 1);
  assert.equal(v.people[0], before);
});
