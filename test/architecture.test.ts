import { test } from "node:test";
import assert from "node:assert/strict";
import { World, carveCove, newVolume, DECK_Y, type Prop } from "../src/world.ts";
import { WorldOps } from "../src/world-ops.ts";
import { Edits } from "../src/edits.ts";
import { seedCove, seedStarter } from "../src/seed.ts";
import { villagerHomes, houseLayout, makeHouse } from "../src/house-model.ts";
import { doorEnds } from "../src/house-ops.ts";

function blank() { const world = new World(); world.heights.fill(8); return { world, ops: new WorldOps(world) }; }

test("landmark placement rejects blocked sites without changing the world", () => {
  const { world, ops } = blank();
  const before = world.save();
  const result = ops.placeLandmark("bakery", -12, -12, 0.25, {}, false, 0);
  assert.equal(result.ok, false);
  assert.deepEqual(world.save(), before);
});

test("rejected revisions leave an existing shop unchanged; accepted changes undo as one edit", () => {
  const { world, ops } = blank();
  const p: Prop = { id: "market", type: "market", x: 24, z: 24, rot: 0, seed: 0.3 };
  world.props.set(p.id, p);
  const saved = world.save();
  const original = world.props.get(p.id)!;
  const fail = ops.reviseProp(p.id, { x: -20, z: -20 });
  assert.equal(fail.ok, false);
  assert.deepEqual(world.save(), saved);
  const edits = new Edits(world);
  edits.begin();
  const change = ops.reviseProp(p.id, { seed: 0.4, opts: { vendor: "fruit" } });
  assert.equal(change.ok, true);
  assert.equal(original.seed, 0.3);
  assert.notStrictEqual(world.props.get(p.id), original);
  if (change.ok) assert.deepEqual(change.change, { structures: true });
  assert.equal(edits.commit(), true);
  assert.equal(edits.undo(), true);
  assert.deepEqual(world.save(), saved);
  assert.equal(edits.redo(), true);
  assert.equal(world.props.get(p.id)?.opts?.vendor, "fruit");
});

test("removing a grotto restores the derived surface without erasing terrain edits", () => {
  const { world, ops } = blank();
  const p: Prop = { id: "g", type: "grotto", x: 24, z: 24, rot: 0, seed: 0.3 };
  world.props.set(p.id, p); world.rebuildCarving();
  const under = p.carved![0];
  assert.ok(under);
  world.setLevel(under[0], under[1], 20);
  assert.ok(world.level(under[0], under[1]) < 20);
  assert.deepEqual(ops.removeProp(p.id), { terrain: true, structures: true });
  assert.equal(world.level(under[0], under[1]), 20);
});

test("house panel edits copy records, reject bad values and undo a wing", () => {
  const { world, ops } = blank();
  const h = makeHouse("home", 0.2, [newVolume(20, 20, 23, 23)]);
  world.houses.set(h.id, h);
  const before = world.save(), edits = new Edits(world);
  assert.equal(ops.editHouse(h.id, 0, { kind: "pitch", value: NaN }).ok, false);
  assert.deepEqual(world.save(), before);
  edits.begin();
  const roof = ops.editHouse(h.id, 0, { kind: "roof", value: "flat" });
  const wing = ops.editHouse(h.id, 0, { kind: "wing", value: "tower" });
  assert.equal(roof.ok, true); assert.equal(wing.ok, true);
  assert.equal(h.volumes[0].roof, "gable", "old house references stay unchanged");
  assert.equal(h.volumes.length, 1);
  assert.equal(world.houses.get(h.id)!.volumes.length, 2);
  edits.commit(); edits.undo(); assert.deepEqual(world.save(), before);
});

test("moving a house copies its records and follows connected doors", () => {
  const { world, ops } = blank();
  const h = makeHouse("home", 0.2, [newVolume(20, 20, 23, 23)]);
  world.houses.set(h.id, h);
  const y = houseLayout(world, h).base;
  const door = ops.addNode(21.5, 23.6, y), other = ops.addNode(21.5, 26, y);
  ops.addEdge(door, other);
  const connected = doorEnds(world, h);
  assert.equal(connected.length, 1);
  const move = ops.replaceHouse(h.id, { ...h, volumes: h.volumes.map(v => ({ ...v, z0: v.z0 + 1, z1: v.z1 + 1 })) }, { origin: h, doors: connected });
  assert.equal(move.ok, true);
  assert.equal(h.volumes[0].z0, 20);
  assert.equal(door.z, 23.6);
  assert.ok(Math.abs(world.nodes.get(door.id)!.z - 24.6) < 1e-6);
});

test("terrain strokes report changes and edit the base beneath a grotto", () => {
  const { world, ops } = blank();
  const p: Prop = { id: "g", type: "grotto", x: 24, z: 24, rot: 0, seed: 0.3 };
  world.props.set(p.id, p); world.rebuildCarving();
  const [i, j] = p.carved![0];
  assert.deepEqual(ops.terrainStroke("raise", i + 0.5, j + 0.5, 0.5), { terrain: true });
  assert.equal(world.baseLevel(i, j), 9);
  assert.ok(world.level(i, j) < 9);
  assert.equal(ops.terrainStroke("flatten", i + 0.5, j + 0.5, 0.5, 9), null);
  assert.deepEqual(ops.removeProp(p.id), { terrain: true, structures: true });
  assert.equal(world.level(i, j), 9);
});

test("walkway settling clears the terrain and preserves a climbable grade", () => {
  const { world, ops } = blank();
  world.heights.fill(2);
  for (let z = 18; z < 25; z++) for (let x = 21; x <= 27; x++) world.setLevel(x, z, 16);
  const a = ops.addNode(24, 16, DECK_Y), b = ops.addNode(24, 27, DECK_Y);
  ops.addEdge(a, b);
  assert.equal(ops.settleWalks(), true);
  assert.ok(world.nodes.size > 2);
  for (const e of world.edges.values()) {
    const x = world.nodes.get(e.a)!, y = world.nodes.get(e.b)!;
    assert.ok(Math.abs(y.y - x.y) / Math.hypot(y.x - x.x, y.z - x.z) <= 0.75 + 1e-6);
  }
});

test("post and walkway panel operations settle the graph and undo together", () => {
  const { world, ops } = blank(); world.heights.fill(2);
  const a = ops.addNode(10, 10, DECK_Y), b = ops.addNode(10, 15, DECK_Y);
  const edge = ops.addEdge(a, b);
  const before = structuredClone(world.save()), edits = new Edits(world);
  assert.equal(ops.editEdge(edge.id, { width: NaN }).ok, false);
  assert.equal(ops.editNode(a.id, { pad: -1 }).ok, false);
  assert.deepEqual(world.save(), before);
  edits.begin();
  const raised = ops.editNode(a.id, { lift: 0.25, pad: 1 });
  const widened = ops.editEdge(edge.id, { width: 1.5, rail: true });
  assert.equal(raised.ok, true); assert.equal(widened.ok, true);
  assert.equal(edits.commit(), true);
  assert.equal(world.nodes.get(a.id)?.pad, 1);
  assert.equal(world.edges.get(edge.id)?.width, 1.5);
  assert.equal(edge.width, before.edges[0].width);
  assert.equal(a.pad, before.nodes[0].pad);
  edits.undo(); assert.deepEqual(world.save(), before);
  edits.redo(); assert.equal(world.edges.get(edge.id)?.rail, true);
});

test("generation runs in Node against world rules, without App or a renderer", () => {
  const starter = blank(); seedStarter(starter.ops);
  assert.ok(starter.world.houses.size >= 5);
  assert.ok(villagerHomes(starter.world).length >= 5);
  for (const h of starter.world.houses.values()) assert.ok(Number.isFinite(houseLayout(starter.world, h).base));
  const make = () => { const w = new World(); carveCove(w, "fjord", 0.42); seedCove(new WorldOps(w), 0.42); return w; };
  const a = make(), b = make();
  assert.ok(a.houses.size > 0 && a.edges.size > 0);
  // IDs are intentionally not stable; topology and positions are.
  const positions = (w: World) => [...w.houses.values()].map(h => h.volumes.map(v => [v.x0, v.z0, v.x1, v.z1]));
  assert.deepEqual(positions(a), positions(b));
  for (const [kind, seed] of [["classic", 6.34], ["fjord", 7.291], ["islets", 0.634]] as const) {
    const w = new World(); carveCove(w, kind, seed); seedCove(new WorldOps(w), seed);
    for (const e of w.edges.values()) {
      const p = w.nodes.get(e.a)!, q = w.nodes.get(e.b)!;
      assert.ok(Math.abs(p.x - q.x) < 1e-6 || Math.abs(p.z - q.z) < 1e-6, `${kind} ${seed}: diagonal seeded walkway`);
    }
  }
});
