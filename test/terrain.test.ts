import { test } from "node:test";
import assert from "node:assert/strict";
import { World, N, WATER_Y, type Prop } from "../src/world.ts";
import * as THREE from "three/webgpu";
import { Terrain, RES, GRID } from "../src/terrain.ts";
import { MeshBuilder } from "../src/mesh.ts";
import { buildOneProp } from "../src/props.ts";

function floorAt(m: MeshBuilder, x: number, z: number) {
  let highest = -Infinity;
  for (let i = 0; i < m.idx.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map(n => {
      const k = m.idx[i + n] * 3;
      return [m.pos[k], m.pos[k + 1], m.pos[k + 2]];
    });
    const det = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
    if (Math.abs(det) < 1e-8) continue;
    const u = ((x - a[0]) * (c[2] - a[2]) - (z - a[2]) * (c[0] - a[0])) / det;
    const v = ((b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0])) / det;
    if (u < 0 || v < 0 || u + v > 1) continue;
    const y = a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]);
    if (y < WATER_Y) highest = Math.max(highest, y);
  }
  return highest;
}

test("submerged terrain triangles stay covered beneath the grotto floor", () => {
  const w = new World(); w.heights.fill(18);
  for (let j = 24; j < N; j++) for (let i = 0; i < N; i++) w.setLevel(i, j, 2);
  const p: Prop = { id: "g", type: "grotto", x: 24, z: 24, rot: 0, seed: 0.3, opts: { size: 1 } };
  w.props.set(p.id, p); w.rebuildCarving();
  const t = new Terrain(w, new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial());
  const pos = t.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const indices = t.mesh.geometry.getIndex()!.array;
  const covered = new Uint8Array((GRID - 1) * (GRID - 1));
  for (let k = 0; k < indices.length; k += 3) {
    const a = indices[k], b = indices[k + 1], c = indices[k + 2];
    const i = Math.min(a % GRID, b % GRID, c % GRID), j = Math.min(Math.floor(a / GRID), Math.floor(b / GRID), Math.floor(c / GRID));
    covered[j * (GRID - 1) + i]++;
  }
  let missing = 0;
  for (let j = (p.z - 1) * RES; j < (p.z + 1) * RES; j++) for (let i = (p.x - 2) * RES; i < (p.x + 2) * RES; i++) {
    const vertices = [j * GRID + i, j * GRID + i + 1, (j + 1) * GRID + i, (j + 1) * GRID + i + 1];
    if (vertices.every(k => pos.getY(k) < WATER_Y - 0.05) && covered[j * (GRID - 1) + i] < 2) missing++;
  }
  assert.equal(missing, 0, "the underwater mouth must not expose holes in the seabed");
});

test("the grotto mouth has submerged backing beneath cut-out terrain", () => {
  const w = new World(); w.heights.fill(18);
  for (let j = 24; j < N; j++) for (let i = 0; i < N; i++) w.setLevel(i, j, 2);
  const p: Prop = { id: "g", type: "grotto", x: 24, z: 24, rot: 0, seed: 0.3, opts: { size: 1 } };
  w.props.set(p.id, p); w.rebuildCarving();
  const t = new Terrain(w, new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial());
  const backing = (t as Terrain & { seabed?: THREE.Mesh }).seabed;
  assert.ok(backing?.geometry.getIndex()?.count, "missing triangles around the cave feet expose empty space through clear water");
  const pos = backing.geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) assert.ok(pos.getY(i) < WATER_Y, "backing must remain below the water, not seal the cave entrance");
  w.props.delete(p.id); w.rebuildCarving(); t.rebuild();
  assert.equal(t.seabed.visible, false, "removing the grotto removes its backing too");
});

for (const size of [0, 1, 2]) for (const rot of [0, Math.PI / 2]) test(`grotto ${size} floor meets the seabed at the ${rot ? "turned" : "front"} mouth`, () => {
  const w = new World(); w.heights.fill(18);
  const p: Prop = { id: "g", type: "grotto", x: 24, z: 24, rot, seed: 0.3, opts: { size, dock: "left" } };
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const dx = i + 0.5 - p.x, dz = j + 0.5 - p.z;
    if (-dx * s + dz * c >= 0) w.setLevel(i, j, 2);
  }
  w.props.set(p.id, p); w.rebuildCarving();
  const mesh = new MeshBuilder(); buildOneProp(w, mesh, p, { lights: [], foam: [] });
  for (const lx of [-0.4, 0, 0.4]) {
    const x = p.x + lx * c - 0.14 * s, z = p.z + lx * s + 0.14 * c;
    const floor = floorAt(mesh, x, z), seabed = w.height(x, z);
    assert.ok(Number.isFinite(floor));
    assert.ok(Math.abs(floor - seabed) < 0.15, `offset ${lx}: floor ${floor.toFixed(2)} vs seabed ${seabed.toFixed(2)}`);
  }
});
