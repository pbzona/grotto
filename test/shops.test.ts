import { test } from "node:test";
import assert from "node:assert/strict";
import { World, SHOP_DIMS, isShop, isBuildingProp, landmarkSamples, shopEntrance, shopBase, type Prop, type ShopType } from "../src/world.ts";

for (const type of ["market", "boatyard", "bakery"] as ShopType[]) test(`${type} footprint, entrance, save and overlap`, () => {
  const w = new World(); w.heights.fill(8);
  const p: Prop = { id: type, type, x: 24, z: 24, rot: Math.PI / 2, seed: 0.3 };
  const { w: width, d } = SHOP_DIMS[type], entry = shopEntrance(p), pts = landmarkSamples(p);
  assert.equal(isShop(type), true); assert.equal(isBuildingProp(type), true);
  assert.ok(Math.abs(entry.x - (24 - d / 2 - 0.6)) < 0.001 && Math.abs(entry.z - 24) < 0.001);
  assert.ok(pts.length > 20 && pts.some(([x, z]) => Math.abs(z - 24) >= width / 2 - 0.1));
  assert.ok(shopBase(w, p) > w.height(24, 24));
  w.props.set(p.id, p);
  assert.equal(w.footprintFree(23, 23, 25, 25), false);
  const copy = new World(); copy.load(w.save()); assert.deepEqual(copy.props.get(p.id), p);
});

test("older coves and existing landmarks remain valid", () => {
  const w = new World();
  for (const type of ["hull", "lighthouse", "grotto"] as const) {
    assert.equal(isBuildingProp(type), type !== "grotto");
    w.props.set(type, { id: type, type, x: 20, z: 20, rot: 0, seed: 0.4 });
  }
  const copy = new World(); copy.load(w.save()); assert.equal(copy.props.size, 3);
});
