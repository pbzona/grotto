import { test } from "node:test";
import assert from "node:assert/strict";
import { World, N, DECK_Y, grottoTies } from "../src/world.ts";
import { navGrid, isFree } from "../src/voyages.ts";
import { planRun, runAt, CRATES } from "../src/smuggling.ts";

/** High land with the open sea across the south. */
function coast() {
  const w = new World();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) w.setLevel(i, j, j >= 30 ? 2 : 10);
  return w;
}
const LOOK = [{ house: "look", x: 10, y: 9, z: 10 }];
const node = (w: World, id: string, x: number, z: number, y = DECK_Y, pad = 0) => w.nodes.set(id, { id, x, z, y, pad });
const edge = (w: World, id: string, a: string, b: string) => w.edges.set(id, { id, a, b, width: 1.1, style: "deck", rail: false });
/** A pier running out from the shore to a head over deep water, its root at a house door. */
function pier(w: World) {
  node(w, "door", 20, 28, DECK_Y + 0.3); node(w, "mid", 20, 32); node(w, "head", 20, 37, DECK_Y, 1.5);
  edge(w, "e1", "door", "mid"); edge(w, "e2", "mid", "head");
  return [{ house: "h1", node: "door", seed: 0.4, size: 1 }];
}

test("no lookout, no run; a lookout with nowhere to land gutters out at dusk", () => {
  const w = coast(), homes = pier(w);
  const none = planRun(w, [], homes);
  assert.equal(none.signal, null);
  assert.equal(runAt(none, 22).boat, null);
  const bare = coast();
  const dark = planRun(bare, LOOK, []);
  assert.equal(dark.signal, "dark");
  assert.ok(runAt(dark, 19.15).signal > 0.1, "lit at dusk");
  assert.equal(runAt(dark, 19.9).signal, 0, "then out");
  for (let h = 0; h < 24; h += 0.25) assert.equal(runAt(dark, h).boat, null);
});

test("a run to a pier: signal, boat in and out, crates carried home and used up by noon", () => {
  const w = coast(), homes = pier(w);
  const plan = planRun(w, LOOK, homes);
  assert.equal(plan.signal, "run");
  assert.equal(plan.landing?.kind, "pier");
  assert.equal(plan.home, "h1");
  assert.ok(runAt(plan, 19.3).signal > 0, "the lantern calls the boat");
  for (const h of [12, 15, 18.9, 6, 9]) assert.equal(runAt(plan, h).boat, null, `no boat at ${h}`);
  assert.ok(plan.leave < 28, "gone before dawn");
  // the boat never crosses land or posts on its way, and moves continuously
  const g = navGrid(w, false);
  let last = runAt(plan, 20.21).boat!;
  for (let h = 20.21; h < plan.leave + plan.travel; h += 0.01) {
    const b = runAt(plan, h % 24).boat;
    if (!b) continue;
    if (b.x > 0 && b.z > 0 && b.x < N && b.z < N) assert.ok(isFree(g, b.x, b.z) || Math.hypot(b.x - plan.landing!.x, b.z - plan.landing!.z) < 1, `afloat at ${h.toFixed(2)}`);
    assert.ok(Math.hypot(b.x - last.x, b.z - last.z) < 0.6, `smooth at ${h.toFixed(2)}`);
    last = b;
  }
  // every crate comes off the boat and ends up by the door
  assert.equal(runAt(plan, plan.arrive - 0.05).boat?.cargo, CRATES);
  assert.equal(runAt(plan, (plan.leave + 0.05) % 24).boat?.cargo, 0);
  let carried = 0;
  for (let h = 20; h < 28; h += 0.02) carried = Math.max(carried, runAt(plan, h % 24).carriers.filter(c => c.loaded).length);
  assert.ok(carried >= 1, "someone carries a crate");
  const dawn = runAt(plan, 5.5).stack!;
  assert.equal(dawn.scales.filter(s => s > 0.99).length, CRATES, "all three by the door at dawn");
  assert.ok(Math.hypot(dawn.x - 20, dawn.z - 28) < 0.8, "beside the door");
  assert.equal(runAt(plan, 12.5).stack, null, "used up by noon");
  assert.equal(runAt(plan, 5.5).carriers.length, 0, "everyone is home by dawn");
  assert.deepEqual(planRun(w, LOOK, homes).path, plan.path, "deterministic");
});

test("carriers crossing a grounded rope edge stay above the ground", () => {
  const w = coast();
  for (let j = 0; j < 32; j++) for (let i = 0; i < N; i++) w.setLevel(i, j, 7);
  const homes = pier(w); w.edges.get("e1")!.style = "rope";
  const plan = planRun(w, LOOK, homes);
  assert.equal(plan.signal, "run");
  assert.ok(plan.walk.some(s => s.rope));
  let inspected = 0;
  for (let h = 20; h < 28; h += 0.01) for (const c of runAt(plan, h % 24).carriers) {
    if (c.z < 29 || c.z > 31) continue;
    inspected++;
    assert.ok(c.y >= w.height(c.x, c.z), `carrier buried at ${c.z.toFixed(2)}: ${c.y.toFixed(2)}`);
  }
  assert.ok(inspected > 0, "carriers crossed the rope edge");
});

test("a landing with no way home: the boat waits and leaves still loaded", () => {
  const w = coast(); pier(w);
  const plan = planRun(w, LOOK, []);
  assert.equal(plan.signal, "run");
  assert.equal(plan.home, null);
  assert.ok(runAt(plan, (plan.arrive + 0.5) % 24).boat, "it comes in");
  assert.equal(runAt(plan, (plan.leave + 0.1) % 24).boat?.cargo, CRATES, "and leaves loaded");
  for (let h = 0; h < 24; h += 0.1) { const s = runAt(plan, h); assert.equal(s.carriers.length, 0); assert.equal(s.stack, null); }
});

test("a connected pier beats an unconnected cave; a connected cave beats both", () => {
  const w = coast(), homes = pier(w);
  w.props.set("g", { id: "g", type: "grotto", x: 32, z: 30.4, rot: 0, seed: 0.3, opts: { size: 1, dock: "left" } });
  w.rebuildCarving();
  const loose = planRun(w, LOOK, homes);
  assert.equal(loose.landing?.kind, "pier", "the pier has a way home, the cave doesn't");
  assert.equal(loose.home, "h1");
  const alone = planRun(w, LOOK, []);
  assert.equal(alone.landing?.kind, "grotto", "with no way home anywhere the boat waits at the cave");
  assert.equal(alone.home, null);
  const [tie] = grottoTies(w.props.get("g")!);
  node(w, "tie", tie.x, tie.z); node(w, "bend", tie.x, 28, DECK_Y + 0.3); edge(w, "t1", "tie", "bend"); edge(w, "t2", "bend", "door");
  const tied = planRun(w, LOOK, homes);
  assert.equal(tied.landing?.kind, "grotto");
  assert.equal(tied.home, "h1");
  assert.ok(Math.hypot(tied.landing!.x - 32, tied.landing!.z - 30.4) < 1.5, "berths inside the mouth");
  const end = tied.walk[tied.walk.length - 1];
  assert.ok(end.bz < tie.z - 0.6 && Math.abs(end.bz - tied.landing!.z) < 0.4, "carriers load from the dock beside the boat, not out at the tie");
});
