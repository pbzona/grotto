import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/world.ts";
import { Villagers, headcount, route, walkGraph, villagerVisits, MAX_VILLAGERS, type Home } from "../src/villagers.ts";

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

test("headcount: each walkway holds people by its length", () => {
  const w = new World(); line(w, ["a", "b", "c"]); line(w, ["x", "y"]); w.nodes.get("x")!.z = 30; w.nodes.get("y")!.z = 30;
  // a: 4 units of walkway, x: 2 units
  const homes: Home[] = ["h1", "h2", "h3", "h4"].map((house, i) => ({ house, node: "a", seed: i, size: 2 }));
  homes.push({ house: "k1", node: "x", seed: 9, size: 2 }, { house: "k2", node: "x", seed: 10, size: 1 });
  const sum = (m: Map<string, number>) => [...m.values()].reduce((s, n) => s + n, 0);
  const c = headcount(homes, w, 0.5);
  assert.deepEqual([...c].sort(), [["h1", 1], ["h2", 1], ["k1", 1]]);
  assert.equal(sum(headcount(homes, w, 0.01)), 2, "every walkway keeps at least one");
  assert.equal(sum(headcount(homes, w, 10)), 11, "plenty of room: everyone, seconds for big houses");
  assert.ok(sum(headcount(homes, w, 0.5)) < sum(headcount(homes, w, 1)));
});

test("route follows the graph and fails across a gap", () => {
  const w = new World(); line(w, ["a", "b", "c", "d"]);
  assert.deepEqual(route(w, "a", "d"), ["b", "c", "d"]);
  w.edges.delete("ebc");
  assert.equal(route(w, "a", "d"), null);
});

test("villagers appear at the door, stay on the walkways and their component", () => {
  const w = new World(); line(w, ["a", "b", "c", "d"]); line(w, ["x", "y"]); w.nodes.get("x")!.z = 30; w.nodes.get("y")!.z = 30;
  const v = new Villagers(); v.density = 1;
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

test("villagers on ground-level rope paths walk on the ground, not through it", () => {
  const w = new World(); w.heights.fill(8); line(w, ["a", "b"], w.height(11, 10) + 0.2);
  w.nodes.get("b")!.x = 18; w.edges.get("eab")!.style = "rope";
  const v = new Villagers(); v.density = 1;
  v.sync(w, [{ house: "h", node: "a", seed: 3, size: 1 }]);
  const person = v.people[0]; person.phase = "walk"; person.path = ["b"]; person.d = 4; person.speed = 0;
  v.update(w, 0.1);
  assert.ok(person.y >= w.height(person.x, person.z), `person buried at ${person.y}`);
  w.props.set("grotto", { id: "grotto", type: "grotto", x: 40, z: 40, rot: 0, seed: 0.3 });
  w.rebuildCarving();
  v.update(walkGraph(w), 0.1);
  assert.ok(person.y >= w.height(person.x, person.z), "a copied walkway graph also sees the terrain");
  w.nodes.get("a")!.y += 2; w.nodes.get("b")!.y += 2;
  v.update(w, 0.1);
  assert.ok(person.y > w.height(person.x, person.z) + 1, "suspended rope still sags above ground");
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

test("shops only attract connected residents; the market lingers and the bakery opens indoors", () => {
  const w = new World(); w.heights.fill(8); line(w, ["a", "b", "c", "d"], w.height(12, 10) + 0.2);
  w.props.set("m", { id: "m", type: "market", x: 16, z: 7.8, rot: 0, seed: 0.4 });
  // entrance is at z=10, on the final walkway node
  const visits = villagerVisits(w);
  assert.deepEqual(visits.map(v => [v.id, v.node, v.mode]), [["m", "d", "linger"]]);
  const v = new Villagers(); v.density = 1;
  const homes: Home[] = [{ house: "h", node: "a", seed: 0.4, size: 1 }];
  v.sync(w, homes, visits);
  let lingered = false;
  for (let i = 0; i < 1600; i++) {
    v.update(w, 0.1);
    if (v.people[0]?.phase === "visit") lingered = true;
  }
  assert.ok(lingered, "market becomes a reachable destination");
  w.props.get("m")!.type = "bakery";
  w.props.get("m")!.z = 7.9; // bakery front + 1.5 + 0.6 = 10
  v.sync(w, homes, villagerVisits(w));
  let entered = false, emerged = false;
  for (let i = 0; i < 1800; i++) {
    v.update(w, 0.1);
    if (v.people[0]?.phase === "inside") entered = true;
    if (entered && v.people[0]?.phase === "emerge") emerged = true;
  }
  assert.ok(entered && emerged, "visitors reappear after entering");
  w.edges.delete("ecd");
  assert.deepEqual(villagerVisits(w), [], "a disconnected threshold is not a destination");
  v.sync(w, homes, villagerVisits(w));
  assert.ok(v.people.every(p => !p.visit), "the lost visit is cancelled");
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
