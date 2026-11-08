import { type Prop, type World, SHOP_DIMS, shopBase, type ShopType } from "./world";
import { MeshBuilder, M, hexRGB, rng, type V3 } from "./mesh";
import type { Light } from "./houses";

const color = (m: MeshBuilder, hex: string, pattern: number) => m.paint(hexRGB(hex), pattern);
const plank = "#76553e", dark = "#513b2f", stone = "#b99c75", cream = "#e3d2ae";

function frame(m: MeshBuilder, x: number, z: number, h: number, low = -0.3) {
  color(m, dark, M.plank); m.cyl(x, z, low, h, 0.075, 0.065, 6);
}
function lamp(m: MeshBuilder, L: Light[], x: number, y: number, z: number) {
  color(m, "#634a36", M.metal); m.cyl(x, z, y + 0.08, y + 0.2, 0.025, 0.025, 6);
  color(m, "#ffc579", M.lamp); m.cyl(x, z, y - 0.14, y + 0.08, 0.07, 0.055, 6);
  L.push({ x, y, z, r: 2.4, i: 0.65 });
}
function roof(m: MeshBuilder, w: number, d: number, eave: number, ridge: number, tiles: string) {
  const x = w / 2 + 0.22, z = d / 2 + 0.2;
  color(m, tiles, M.tile);
  m.quad([[-x, eave, -z], [-x, eave, z], [0, ridge, z], [0, ridge, -z]], [-1, 1, 0]);
  m.quad([[x, eave, z], [x, eave, -z], [0, ridge, -z], [0, ridge, z]], [1, 1, 0]);
  color(m, dark, M.plank);
  for (const xx of [-x, x]) m.beam([xx, eave, -z], [xx, eave, z], [1, 0, 0], 0.045, 0.045);
  m.beam([0, ridge, -z], [0, ridge, z], [1, 0, 0], 0.05, 0.05);
}
function basket(m: MeshBuilder, x: number, z: number, y: number, seed: number) {
  color(m, "#a77b4d", M.plank); m.cyl(x, z, y, y + 0.22, 0.27, 0.32, 8);
  color(m, seed < 0.5 ? "#849453" : "#cb7650", M.leaf);
  for (let k = 0; k < 5; k++) {
    const a = k * Math.PI * 2 / 5 + seed;
    m.blob([x + Math.cos(a) * 0.14, y + 0.23, z + Math.sin(a) * 0.14], [0.1, 0.1, 0.1], seed * 100 + k, 0);
  }
}
function market(m: MeshBuilder, p: Prop, L: Light[]) {
  const { w, d } = SHOP_DIMS.market, r = rng(p.seed), hw = w / 2, hd = d / 2;
  color(m, stone, M.stone); m.box([-hw, -0.25, -hd], [hw, 0, hd]);
  color(m, "#a27b52", M.plank); m.box([-hw + 0.12, 0, -hd + 0.12], [hw - 0.12, 0.09, hd - 0.12]);
  for (const x of [-hw + 0.15, hw - 0.15]) for (const z of [-hd + 0.15, hd - 0.15]) frame(m, x, z, 2.15, -0.12);
  color(m, plank, M.plank);
  for (const z of [-hd + 0.15, hd - 0.15]) m.beam([-hw + 0.15, 2.13, z], [hw - 0.15, 2.13, z], [0, 0, 1], 0.075, 0.075);
  // Three pitched canvas bays leave a lively, uneven roofline, open on every side.
  const cloth = ["#c66e4f", "#eadcba", "#648e8a", "#d3a658"];
  for (let i = 0; i < 3; i++) {
    const x0 = -hw + i * w / 3, x1 = x0 + w / 3, top = 2.58 + (i % 2) * 0.19;
    const tint = Math.floor(r() * cloth.length);
    for (let k = 0; k < 6; k++) {
      const a = x0 + (x1 - x0) * k / 6, b = x0 + (x1 - x0) * (k + 1) / 6;
      color(m, cloth[k % 2 ? tint : (tint + 1) % cloth.length], M.cloth);
      m.quad([[a, 2.12, -hd - 0.16], [b, 2.12, -hd - 0.16], [b, top, 0], [a, top, 0]], [0, 1, -1]);
      m.quad([[a, top, 0], [b, top, 0], [b, 2.12, hd + 0.16], [a, 2.12, hd + 0.16]], [0, 1, 1]);
    }
    color(m, dark, M.plank); m.beam([x0, top + 0.02, 0], [x1, top + 0.02, 0], [0, 0, 1], 0.025, 0.025);
  }
  for (const x of [-1.22, 1.22]) {
    color(m, plank, M.plank); m.box([x - 0.42, 0.55, -0.8], [x + 0.42, 0.68, 0.45]);
    for (const xx of [x - 0.34, x + 0.34]) for (const z of [-0.7, 0.32]) frame(m, xx, z, 0.55, 0);
    for (let i = 0; i < 4; i++) basket(m, x + (i % 2 ? 0.24 : -0.24), -0.5 + Math.floor(i / 2) * 0.54, 0.68, r());
  }
  basket(m, -hw + 0.36, hd - 0.32, 0.08, r());
  lamp(m, L, -hw + 0.2, 1.86, hd - 0.15); lamp(m, L, hw - 0.2, 1.86, hd - 0.15);
}
function boatyard(m: MeshBuilder, p: Prop, L: Light[]) {
  const { w, d } = SHOP_DIMS.boatyard, hw = w / 2, hd = d / 2, r = rng(p.seed);
  color(m, stone, M.stone); m.box([-hw, -0.32, -hd], [hw, 0, hd]);
  color(m, "#87674b", M.plank); m.box([-hw, 0, -hd], [hw, 0.11, hd]);
  color(m, "#80634e", M.plank);
  m.box([-hw, 0.1, -hd], [hw, 2.22, -hd + 0.16]);
  m.box([-hw, 0.1, -hd], [-hw + 0.16, 2.22, hd]);
  m.box([hw - 0.16, 0.1, -hd], [hw, 2.22, hd]);
  // Open front: thick posts and a high lintel leave the boat visible from afar.
  for (const x of [-hw + 0.12, -0.85, 0.85, hw - 0.12]) frame(m, x, hd - 0.07, 2.18, 0);
  color(m, dark, M.plank); m.box([-hw, 2.08, hd - 0.16], [hw, 2.28, hd]);
  for (const x of [-hw, hw]) for (let z = -hd + 0.3; z < hd; z += 0.55) {
    color(m, z < 0 ? "#9c7855" : plank, M.plank); m.box([x - 0.02, 0.25, z], [x + 0.02, 2.05, z + 0.42]);
  }
  roof(m, w, d, 2.22, 3.13, "#7a5b4b");
  // A hull under construction, with ribs proud of its sheer and two trestles below.
  for (const z of [-0.9, 0.55]) {
    color(m, plank, M.plank); m.beam([-0.8, 0.55, z], [0.8, 0.55, z], [0, 0, 1], 0.06, 0.06);
    for (const x of [-0.65, 0.65]) frame(m, x, z, 0.56, 0.08);
  }
  for (let i = 0; i <= 10; i++) {
    const z = -1.2 + i * 0.25, t = (z + 1.2) / 2.5, breadth = 0.78 * Math.sin(Math.PI * t) + 0.08;
    color(m, i % 2 ? "#b18a60" : "#98724d", M.plank);
    m.beam([-breadth, 0.85, z], [0, 0.47, z], [0, 0, 1], 0.033, 0.035);
    m.beam([0, 0.47, z], [breadth, 0.85, z], [0, 0, 1], 0.033, 0.035);
  }
  color(m, dark, M.plank); m.beam([0, 0.46, -1.35], [0, 0.46, 1.45], [1, 0, 0], 0.07, 0.07);
  for (let i = 0; i < 4; i++) {
    color(m, "#8f714e", M.plank); m.cyl(hw - 0.42 - i * 0.14, -1.05, 0.13, 0.16, 0.05, 0.05, 6);
    m.beam([hw - 0.42 - i * 0.14, 0.16, -1.3], [hw - 0.42 - i * 0.14, 0.16, 0.2 + r() * 0.3], [1, 0, 0], 0.04, 0.04);
  }
  // Hoist over the entrance, with a hanging coil.
  color(m, dark, M.plank); m.beam([hw - 0.3, 2.35, hd - 0.25], [hw - 0.3, 2.48, hd + 0.65], [1, 0, 0], 0.07, 0.07);
  color(m, "#c5a775", M.cloth); m.tube([[hw - 0.3, 2.45, hd + 0.57], [hw - 0.3, 1.35, hd + 0.57]], 0.018, 4);
  lamp(m, L, -hw + 0.28, 1.85, hd - 0.2);
}
function bakery(m: MeshBuilder, p: Prop, L: Light[]) {
  const { w, d } = SHOP_DIMS.bakery, hw = w / 2, hd = d / 2, r = rng(p.seed);
  color(m, stone, M.stone); m.box([-hw, -0.26, -hd], [hw, 0.14, hd]);
  color(m, cream, M.plaster); m.box([-hw + 0.1, 0.14, -hd + 0.1], [hw - 0.1, 2.2, hd - 0.1]);
  color(m, "#a98161", M.stone);
  for (const x of [-hw + 0.07, hw - 0.07]) m.box([x - 0.09, 0.1, -hd + 0.06], [x + 0.09, 2.24, hd - 0.06]);
  // A dark door and flanking windows beneath the ochre awning.
  color(m, dark, M.plank); m.box([-0.38, 0.14, hd - 0.08], [0.38, 1.58, hd + 0.015]);
  color(m, "#e6ab59", M.metal); m.cyl(0.27, hd + 0.03, 0.78, 0.84, 0.035, 0.035, 6);
  for (const x of [-1.05, 1.05]) {
    color(m, "#5c7673", M.glass); m.box([x - 0.27, 0.88, hd - 0.06], [x + 0.27, 1.58, hd + 0.035]);
    color(m, dark, M.plank); m.box([x - 0.31, 0.82, hd - 0.07], [x + 0.31, 0.9, hd + 0.08]);
    m.box([x - 0.025, 0.87, hd + 0.04], [x + 0.025, 1.57, hd + 0.06]);
  }
  roof(m, w, d, 2.22, 2.98, "#b97b58");
  color(m, "#c99d4d", M.cloth);
  m.quad([[-hw - 0.08, 1.77, hd], [hw + 0.08, 1.77, hd], [hw + 0.21, 1.49, hd + 0.73], [-hw - 0.21, 1.49, hd + 0.73]], [0, 1, 1]);
  for (const x of [-hw + 0.14, hw - 0.14]) frame(m, x, hd + 0.68, 1.51, 0.1);
  // Projecting oven and oversized chimney, the bakery's unmistakable profile.
  color(m, stone, M.stone); m.box([hw - 0.1, 0.14, -hd + 0.22], [hw + 0.74, 1.23, -hd + 1.45]);
  color(m, "#644337", M.stone); m.box([hw + 0.09, 0.36, -hd + 0.62], [hw + 0.77, 0.95, -hd + 1.07]);
  color(m, stone, M.stone); m.box([hw + 0.04, 1.13, -hd + 0.29], [hw + 0.62, 3.96, -hd + 0.91]);
  m.box([hw - 0.04, 3.85, -hd + 0.2], [hw + 0.71, 4.04, -hd + 1]);
  color(m, "#483831", M.unlit); m.box([hw + 0.14, 4.04, -hd + 0.38], [hw + 0.54, 4.06, -hd + 0.81]);
  basket(m, -hw + 0.3, hd + 0.32, 0.12, r());
  color(m, plank, M.plank); m.box([hw - 0.4, 0.63, hd + 0.17], [hw + 0.24, 0.72, hd + 0.56]);
  for (let i = 0; i < 3; i++) {
    color(m, "#c59857", M.plain); m.blob([hw - 0.25 + i * 0.23, 0.78, hd + 0.35], [0.11, 0.075, 0.13], r() * 100, 0);
  }
  lamp(m, L, -0.59, 1.72, hd + 0.04);
  L.push({ x: hw + 0.45, y: 0.7, z: -hd + 0.86, r: 2.8, i: 0.6 });
}

/** Local coordinates; props.ts applies the same world transform to the mesh and the light points. */
export function buildShop(m: MeshBuilder, world: World, p: Prop, lights: Light[]) {
  const type = p.type as ShopType;
  // The site solver limits the ground drop. Short stone footings conceal the remaining grade.
  const { w, d } = SHOP_DIMS[type], c = Math.cos(p.rot), s = Math.sin(p.rot), base = shopBase(world, p);
  let low = base;
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) low = Math.min(low, world.height(p.x + x * c - z * s, p.z + x * s + z * c));
  const drop = Math.max(0.18, base - low + 0.08);
  color(m, stone, M.stone); m.box([-w / 2 + 0.06, -drop, -d / 2 + 0.06], [w / 2 - 0.06, -0.2, d / 2 - 0.06]);
  if (type === "market") market(m, p, lights);
  else if (type === "boatyard") boatyard(m, p, lights);
  else bakery(m, p, lights);
}
