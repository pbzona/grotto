import { test } from "node:test";
import assert from "node:assert/strict";
import { World, newVolume, SHOP_DIMS, BOATYARD_SLIP, DECK_Y, bakeryDock, isShop, isBuildingProp, landmarkSamples, shopEntrance, shopBase, type Prop, type ShopType } from "../src/world.ts";
import { makeHouse } from "../src/house-model.ts";
import { fitLandmark, landmarkClash } from "../src/placement.ts";
import { WorldOps } from "../src/world-ops.ts";

for (const type of ["market", "boatyard", "bakery"] as ShopType[]) test(`${type} footprint, entrance, save and overlap`, () => {
  const w = new World(); w.heights.fill(8);
  const p: Prop = { id: type, type, x: 24, z: 24, rot: Math.PI / 2, seed: 0.3 };
  const { w: width, d } = SHOP_DIMS[type], entry = shopEntrance(p), pts = landmarkSamples(p);
  assert.equal(isShop(type), true); assert.equal(isBuildingProp(type), true);
  assert.ok(Math.abs(entry.x - (24 + (type === "boatyard" ? 1 : -1) * (d / 2 + 0.6))) < 0.001 && Math.abs(entry.z - 24) < 0.001);
  assert.ok(pts.length > 20 && pts.some(([x, z]) => Math.abs(z - 24) >= width / 2 - 0.1));
  if (type === "boatyard") assert.ok(pts.some(([x]) => x < 24 - d / 2 - BOATYARD_SLIP + 0.3), "slipway reserves its water footprint");
  assert.ok(shopBase(w, p) > w.height(24, 24));
  w.props.set(p.id, p);
  assert.equal(w.footprintFree(23, 23, 25, 25), false);
  const copy = new World(); copy.load(w.save()); assert.deepEqual(copy.props.get(p.id), p);
});

test("water market stands above the sea; bakery needs a fixed deck for its stone quay", () => {
  const w = new World(); w.heights.fill(2);
  const market: Prop = { id: "market", type: "market", x: 24, z: 24, rot: 0, seed: 0.3 };
  assert.equal(shopBase(w, market), DECK_Y);
  const bakery: Prop = { ...market, id: "bakery", type: "bakery", z: 21.9 };
  assert.equal(bakeryDock(w, bakery), undefined);
  for (const [id, z] of [["dock", 24], ["end", 27]] as const) w.nodes.set(id, { id, x: 24, z, y: 1.25, pad: 0 });
  w.edges.set("pier", { id: "pier", a: "dock", b: "end", width: 1.1, style: "deck", rail: false });
  assert.equal(bakeryDock(w, bakery)?.id, "dock");
  assert.equal(shopBase(w, bakery), 1.25);
  w.edges.get("pier")!.style = "rope";
  assert.equal(bakeryDock(w, bakery), undefined);
});

test("market decorations survive save and load", () => {
  const w = new World();
  w.props.set("fruit", { id: "fruit", type: "fruitGarland", x: 12, z: 14, rot: 0.5, seed: 0.25 });
  w.props.set("flag", { id: "flag", type: "pennant", x: 16, z: 14, rot: 1.2, seed: 0.55 });
  const restored = new World(); restored.load(w.save());
  assert.deepEqual(restored.save(), w.save());
});

test("market canopy clears a neighboring two-storey house roof", () => {
  const w = new World(); w.heights.fill(2);
  const house = makeHouse("home", 0.3, [newVolume(20, 20, 23, 23, 2, "hip")]);
  w.houses.set(house.id, house);
  const touching: Prop = { id: "market", type: "market", x: 17.9, z: 21.5, rot: 0, seed: 0.25 };
  assert.ok(landmarkClash(w, touching), "the canvas and house eave intersect although their floor footprints do not");
  const fit = fitLandmark(w, "market", touching.x, touching.z, touching.seed, {}, false, touching.id, 0);
  assert.equal(fit.ok, true);
  assert.ok(20 - (fit.x + SHOP_DIMS.market.w / 2) >= house.volumes[0].overhang - 1e-6, "a fitted market leaves room for the roof eave");
  const reverse = new World(); reverse.heights.fill(2);
  reverse.props.set(touching.id, { ...touching, x: 17.8 });
  assert.equal(reverse.footprintFree(20, 20, 23, 23), false, "placing a house after the market also keeps roofs apart");
  w.props.set(touching.id, touching);
  const repaired = new WorldOps(w).reviseProp(touching.id, { seed: 0.5 });
  assert.equal(repaired.ok, true, "rerolling an old overlapping market can move it to a valid site");
  if (repaired.ok) assert.equal(landmarkClash(w, repaired.value), null);
});

test("a roof edit cannot grow into a neighboring market", () => {
  const w = new World(); w.heights.fill(2);
  w.props.set("market", { id: "market", type: "market", x: 17.55, z: 21.5, rot: 0, seed: 0.25 });
  const ops = new WorldOps(w);
  const placed = ops.placeHouse(makeHouse("ghost", 0.3, [newVolume(20, 20, 23, 23, 2, "flat")]));
  assert.equal(placed.ok, true);
  if (!placed.ok) return;
  const edit = ops.editHouse(placed.value.id, 0, { kind: "roof", value: "hip" });
  assert.equal(edit.ok, false);
  assert.equal(w.houses.get(placed.value.id)?.volumes[0].roof, "flat");
});

test("older coves and existing landmarks remain valid", () => {
  const w = new World();
  for (const type of ["hull", "lighthouse", "grotto"] as const) {
    assert.equal(isBuildingProp(type), type !== "grotto");
    w.props.set(type, { id: type, type, x: 20, z: 20, rot: 0, seed: 0.4 });
  }
  const copy = new World(); copy.load(w.save()); assert.equal(copy.props.size, 3);
});
