import { type Prop, type World, SHOP_DIMS, BOATYARD_SLIP, WATER_Y, shopBase, type ShopType } from "./world";
import { MeshBuilder, M, hexRGB, rng, type V3 } from "./mesh";
import type { Light } from "./houses";

const color = (m: MeshBuilder, hex: string, pattern: number) => m.paint(hexRGB(hex), pattern);
const plank = "#76553e", dark = "#513b2f", stone = "#b99c75", cream = "#e3d2ae";

function localGround(world: World, p: Prop, base: number, x: number, z: number) {
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  let low = Infinity;
  for (const [dx, dz] of [[0, 0], [-0.08, 0], [0.08, 0], [0, -0.08], [0, 0.08]]) {
    low = Math.min(low, world.height(p.x + (x + dx) * c - (z + dz) * s, p.z + (x + dx) * s + (z + dz) * c));
  }
  return low - base - 0.08;
}
function frame(m: MeshBuilder, x: number, z: number, h: number, low = -0.3) {
  color(m, dark, M.plank); m.cyl(x, z, low, h, 0.075, 0.065, 6, false);
}
function lamp(m: MeshBuilder, L: Light[], x: number, y: number, z: number) {
  color(m, "#634a36", M.metal); m.cyl(x, z, y + 0.08, y + 0.2, 0.025, 0.025, 6);
  color(m, "#ffc579", M.lamp); m.cyl(x, z, y - 0.14, y + 0.08, 0.07, 0.055, 6);
  L.push({ x, y, z, r: 2.4, i: 0.65 });
}
function roof(m: MeshBuilder, w: number, d: number, eave: number, ridge: number, tiles: string, gable?: string, backOnly = false) {
  const x = w / 2 + 0.22, z = d / 2 + 0.2;
  color(m, tiles, M.tile);
  m.quad([[-x, eave, -z], [-x, eave, z], [0, ridge, z], [0, ridge, -z]], [-1, 1, 0]);
  m.quad([[x, eave, z], [x, eave, -z], [0, ridge, -z], [0, ridge, z]], [1, 1, 0]);
  if (gable) for (const side of backOnly ? [-1] : [-1, 1]) {
    color(m, gable, M.plaster);
    const faceZ = side * (d / 2 + (backOnly ? 0.035 : 0));
    m.tri([[-w / 2 + 0.08, eave - 0.04, faceZ], [w / 2 - 0.08, eave - 0.04, faceZ], [0, ridge - 0.04, faceZ]], [0, 0, side]);
  }
  color(m, dark, M.plank);
  for (const xx of [-x, x]) m.beam([xx, eave, -z], [xx, eave, z], [1, 0, 0], 0.045, 0.045);
  m.beam([0, ridge, -z], [0, ridge, z], [1, 0, 0], 0.05, 0.05);
}
function basket(m: MeshBuilder, x: number, z: number, y: number, seed: number) {
  color(m, "#a77b4d", M.plank); m.cyl(x, z, y, y + 0.22, 0.27, 0.32, 8, false);
  color(m, seed < 0.5 ? "#849453" : "#cb7650", M.leaf);
  for (let k = 0; k < 5; k++) {
    const a = k * Math.PI * 2 / 5 + seed;
    m.blob([x + Math.cos(a) * 0.14, y + 0.23, z + Math.sin(a) * 0.14], [0.1, 0.1, 0.1], seed * 100 + k, 0);
  }
}
function market(m: MeshBuilder, p: Prop, L: Light[], onWater: boolean) {
  const { w, d } = SHOP_DIMS.market, r = rng(p.seed), hw = w / 2, hd = d / 2;
  const layout = Math.floor(r() * 3);
  color(m, onWater ? "#76553e" : stone, onWater ? M.plank : M.stone); m.box([-hw, -0.25, -hd], [hw, 0, hd]);
  color(m, "#a27b52", M.plank); m.box([-hw + 0.12, 0, -hd + 0.12], [hw - 0.12, 0.09, hd - 0.12], "-y");
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
  // A scalloped front edge gives the pavilion a market silhouette from the quay.
  for (let i = 0; i < 12; i++) {
    const x0 = -hw + i * w / 12, x1 = x0 + w / 12;
    color(m, cloth[i % 3 === 0 ? 2 : i % 2 ? 0 : 1], M.cloth);
    m.tri([[x0, 2.1, hd + 0.17], [x1, 2.1, hd + 0.17], [(x0 + x1) / 2, 1.88, hd + 0.19]], [0, 0, 1]);
  }
  const table = (x: number, z: number, goods: "fish" | "produce" | "cloth") => {
    color(m, plank, M.plank); m.box([x - 0.42, 0.55, z - 0.62], [x + 0.42, 0.68, z + 0.62]);
    for (const xx of [x - 0.34, x + 0.34]) for (const zz of [z - 0.51, z + 0.51]) frame(m, xx, zz, 0.55, 0);
    if (goods === "produce") for (let i = 0; i < 4; i++) basket(m, x + (i % 2 ? 0.24 : -0.24), z - 0.4 + Math.floor(i / 2) * 0.5, 0.68, r());
    else if (goods === "cloth") {
      color(m, "#bf7559", M.cloth); m.box([x - 0.32, 0.69, z - 0.42], [x + 0.32, 0.76, z + 0.09]);
      basket(m, x + 0.17, z + 0.35, 0.68, r());
    } else {
      for (let i = 0; i < 3; i++) {
        const zz = z - 0.35 + i * 0.34;
        color(m, "#73918b", M.plain); m.blob([x - 0.1, 0.74, zz], [0.19, 0.065, 0.08], r() * 100, 0);
        m.tri([[x + 0.05, 0.74, zz], [x + 0.23, 0.78, zz - 0.09], [x + 0.23, 0.7, zz + 0.09]], [0, 1, 0]);
      }
    }
  };
  const crates = (x: number, z: number) => {
    color(m, "#99704d", M.plank); m.box([x - 0.4, 0.09, z - 0.43], [x + 0.38, 0.55, z + 0.32], "-y");
    color(m, "#b78c5d", M.plank); m.box([x - 0.3, 0.55, z - 0.3], [x + 0.2, 0.92, z + 0.18], "-y");
    color(m, "#d4a776", M.plank); m.beam([x - 0.34, 0.19, z + 0.35], [x + 0.32, 0.48, z + 0.35], [0, 0, 1], 0.032, 0.032);
    basket(m, x + 0.17, z + 0.35, 0.09, r());
  };
  if (layout === 0) { table(-1.2, -0.18, "fish"); table(1.2, -0.18, "produce"); basket(m, -1.75, 1.12, 0.09, r()); }
  else if (layout === 1) { table(-1.2, -0.18, "fish"); crates(1.2, -0.42); basket(m, -1.75, 1.12, 0.09, r()); }
  else { table(-1.2, -0.5, "cloth"); table(1.2, -0.18, "produce"); crates(-1.4, 0.87); }
  color(m, "#806046", M.plank); m.box([-0.32, 1.42, hd + 0.13], [0.32, 1.85, hd + 0.2]);
  color(m, "#f1dfb5", M.plain); m.blob([0, 1.64, hd + 0.22], [0.22, 0.075, 0.02], 7, 0);
  color(m, "#a27b52", M.plank); m.box([-0.56, -0.08, hd - 0.02], [0.56, 0.06, hd + 0.75]);
  lamp(m, L, -hw + 0.2, 1.86, hd - 0.15); lamp(m, L, hw - 0.2, 1.86, hd - 0.15);
}
function slipway(m: MeshBuilder, world: World, p: Prop) {
  const { d } = SHOP_DIMS.boatyard, start = d / 2, end = start + BOATYARD_SLIP;
  const c = Math.cos(p.rot), s = Math.sin(p.rot), base = shopBase(world, p);
  const ground = (x: number, z: number) => world.height(p.x + x * c - z * s, p.z + x * s + z * c);
  const top = (z: number) => Math.max(0.1 + (WATER_Y + 0.12 - base - 0.1) * (z - start) / BOATYARD_SLIP, ground(0, z) + 0.13 - base, WATER_Y + 0.12 - base);
  color(m, "#5a4535", M.plank);
  for (const x of [-0.65, 0.65]) {
    for (let k = 0; k < 12; k++) {
      const z0 = start + BOATYARD_SLIP * k / 12, z1 = start + BOATYARD_SLIP * (k + 1) / 12;
      m.beam([x, top(z0), z0], [x, top(z1), z1], [1, 0, 0], 0.09, 0.08);
    }
    for (const z of [start + 0.35, start + 1.65, end - 0.22]) m.cyl(x, z, ground(x, z) - base - 0.2, top(z), 0.075, 0.075, 6);
  }
  for (let k = 0; k <= 10; k++) {
    const z = start + BOATYARD_SLIP * k / 10;
    color(m, k % 2 ? "#876849" : "#a27c53", M.plank);
    m.beam([-0.72, top(z) - 0.035, z], [0.72, top(z) - 0.035, z], [0, 0, 1], 0.06, 0.04);
  }
  // The open ribs ride on the rails with the bow pointing out into the shallows.
  const stern = start + 0.5, bow = end - 0.32;
  color(m, dark, M.plank); m.beam([0, top(stern) + 0.18, stern], [0, top(bow) + 0.18, bow], [1, 0, 0], 0.07, 0.065);
  for (let i = 0; i <= 9; i++) {
    const z = stern + (bow - stern) * i / 9, width = 0.07 + 0.65 * Math.sin(Math.PI * i / 9), y = top(z);
    color(m, i % 2 ? "#b18a60" : "#98724d", M.plank);
    m.beam([-width, y + 0.58, z], [0, y + 0.16, z], [0, 0, 1], 0.035, 0.037);
    m.beam([0, y + 0.16, z], [width, y + 0.58, z], [0, 0, 1], 0.035, 0.037);
    if (i > 1 && i < 8) m.beam([-width * 0.82, y + 0.52, z], [-width * 0.76, y + 0.52, z + 0.22], [0, 1, 0], 0.035, 0.03);
  }
  // A few painted strakes on one side; the other side still shows the unfinished ribs.
  for (let k = 2; k < 7; k++) {
    const a = stern + (bow - stern) * k / 9, b = stern + (bow - stern) * (k + 1) / 9;
    const wa = 0.07 + 0.65 * Math.sin(Math.PI * k / 9), wb = 0.07 + 0.65 * Math.sin(Math.PI * (k + 1) / 9);
    color(m, k % 3 === 0 ? "#4b7574" : "#386467", M.plank);
    m.quad([[-wa, top(a) + 0.57, a], [-wb, top(b) + 0.57, b], [-wb * 0.55, top(b) + 0.3, b], [-wa * 0.55, top(a) + 0.3, a]], [-1, 0, 0]);
  }
}
function boatyard(m: MeshBuilder, world: World, p: Prop, L: Light[]) {
  const { w, d } = SHOP_DIMS.boatyard, hw = w / 2, hd = d / 2, r = rng(p.seed);
  color(m, stone, M.stone); m.box([-hw, -0.32, -hd], [hw, 0, hd]);
  color(m, "#87674b", M.plank); m.box([-hw, 0, -hd], [hw, 0.11, hd], "-y");
  color(m, "#80634e", M.plank);
  m.box([-hw, 0.1, -hd], [hw, 2.22, -hd + 0.16], "+x-x");
  color(m, dark, M.plank); m.box([-0.42, 0.12, -hd - 0.04], [0.42, 1.68, -hd + 0.18]);
  color(m, "#d8ad68", M.metal); m.cyl(-0.29, -hd - 0.06, 0.82, 0.87, 0.035, 0.035, 6);
  color(m, "#80634e", M.plank);
  m.box([-hw, 0.1, -hd], [-hw + 0.16, 2.22, hd], "-z");
  m.box([hw - 0.16, 0.1, -hd], [hw, 2.22, hd], "-z");
  // Open front: thick posts and a high lintel leave the boat visible from afar.
  for (const x of [-hw + 0.12, -0.85, 0.85, hw - 0.12]) frame(m, x, hd - 0.07, 2.18, 0);
  color(m, dark, M.plank); m.box([-hw, 2.08, hd - 0.16], [hw, 2.28, hd]);
  for (const x of [-hw, hw]) for (let z = -hd + 0.3; z < hd; z += 0.55) {
    color(m, z < 0 ? "#9c7855" : plank, M.plank); m.box([x - 0.02, 0.25, z], [x + 0.02, 2.05, z + 0.42]);
  }
  roof(m, w, d, 2.22, 3.13, "#7a5b4b", "#80634e", true);
  // A work bench, loose timbers and spars leave the open bay legible behind the boat.
  color(m, plank, M.plank); m.box([-hw + 0.2, 0.6, -0.55], [-hw + 0.95, 0.73, 0.9]);
  for (const x of [-hw + 0.34, -hw + 0.8]) for (const z of [-0.45, 0.75]) frame(m, x, z, 0.6, 0.1);
  for (let k = 0; k < 5; k++) {
    color(m, k % 2 ? "#9f7956" : "#74543b", M.plank);
    m.beam([hw - 0.4 - k * 0.13, 0.22 + k * 0.12, -1.3], [hw - 0.4 - k * 0.13, 0.22 + k * 0.12, 0.7], [1, 0, 0], 0.045, 0.045);
  }
  slipway(m, world, p);
  for (let i = 0; i < 4; i++) {
    color(m, "#8f714e", M.plank); m.cyl(hw - 0.42 - i * 0.14, -1.05, 0.13, 0.16, 0.05, 0.05, 6);
    m.beam([hw - 0.42 - i * 0.14, 0.16, -1.3], [hw - 0.42 - i * 0.14, 0.16, 0.2 + r() * 0.3], [1, 0, 0], 0.04, 0.04);
  }
  // A sailcloth patch, hoist and hanging coil show the workshop's trade.
  color(m, "#d8c6a4", M.cloth);
  m.quad([[hw - 0.2, 1.82, -hd + 0.38], [hw - 0.2, 1.82, hd - 0.38], [hw - 0.2, 0.6, hd - 0.28], [hw - 0.2, 0.74, -hd + 0.28]], [-1, 0, 0]);
  color(m, dark, M.plank); m.beam([hw - 0.3, 2.35, hd - 0.25], [hw - 0.3, 2.48, hd + 0.65], [1, 0, 0], 0.07, 0.07);
  color(m, "#c5a775", M.cloth); m.tube([[hw - 0.3, 2.45, hd + 0.57], [hw - 0.3, 1.35, hd + 0.57]], 0.018, 4);
  lamp(m, L, -hw + 0.28, 1.85, hd - 0.2);
  lamp(m, L, 0.7, 1.8, -hd - 0.08);
}
function bakery(m: MeshBuilder, world: World, p: Prop, L: Light[]) {
  const { w, d } = SHOP_DIMS.bakery, hw = w / 2, hd = d / 2, r = rng(p.seed), base = shopBase(world, p);
  color(m, stone, M.stone); m.box([-hw, -0.26, -hd], [hw, 0.14, hd]);
  color(m, cream, M.plaster); m.box([-hw + 0.1, 0.14, -hd + 0.1], [hw - 0.1, 2.2, hd - 0.1], "-y");
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
  // Lit rear and side windows keep the shop from reading as a blank house from across the cove.
  color(m, "#5c7673", M.glass);
  m.box([-0.95, 0.89, -hd - 0.025], [-0.37, 1.62, -hd + 0.08]);
  m.box([-hw - 0.03, 0.9, -0.45], [-hw + 0.09, 1.65, 0.22]);
  color(m, dark, M.plank);
  m.box([-1.01, 0.84, -hd - 0.08], [-0.31, 0.91, -hd + 0.1]);
  m.box([-hw - 0.08, 0.84, -0.51], [-hw + 0.1, 0.91, 0.28]);
  for (const z of [-hd - 0.07, hd + 0.07]) {
    color(m, "#806348", M.plank); m.box([-0.23, 2.43, z - 0.025], [0.23, 2.65, z + 0.025]);
    color(m, dark, M.plank); m.box([-0.18, 2.47, z - 0.04], [0.18, 2.61, z + 0.04]);
  }
  roof(m, w, d, 2.22, 2.98, "#b97b58", cream);
  color(m, "#c99d4d", M.cloth);
  m.quad([[-hw - 0.08, 1.77, hd], [hw + 0.08, 1.77, hd], [hw + 0.21, 1.49, hd + 0.73], [-hw - 0.21, 1.49, hd + 0.73]], [0, 1, 1]);
  for (const x of [-hw + 0.14, hw - 0.14]) frame(m, x, hd + 0.68, 1.51, Math.min(0.1, localGround(world, p, base, x, hd + 0.68)));
  // Projecting oven and oversized chimney, the bakery's unmistakable profile.
  color(m, stone, M.stone); m.box([hw - 0.1, 0.14, -hd + 0.22], [hw + 0.74, 1.23, -hd + 1.45], "-x");
  color(m, "#ad8c69", M.stone);
  for (let i = 0; i < 3; i++) m.box([hw + 0.73, 0.35 + i * 0.24, -hd + 0.42], [hw + 0.79, 0.4 + i * 0.24, -hd + 1.22]);
  color(m, stone, M.stone); m.box([hw + 0.04, 1.13, -hd + 0.29], [hw + 0.62, 3.96, -hd + 0.91]);
  m.box([hw - 0.04, 3.85, -hd + 0.2], [hw + 0.71, 4.04, -hd + 1]);
  color(m, "#483831", M.unlit); m.box([hw + 0.14, 4.04, -hd + 0.38], [hw + 0.54, 4.06, -hd + 0.81], "-y");
  color(m, "#6f6152", M.stone); m.box([hw + 0.03, 3.2, -hd + 0.28], [hw + 0.64, 3.32, -hd + 0.92]);
  color(m, dark, M.plank); m.box([-0.35, 1.79, hd + 0.07], [0.35, 2.1, hd + 0.14]);
  color(m, "#e9c28b", M.plain); m.blob([0, 1.93, hd + 0.17], [0.23, 0.085, 0.025], 6, 0);
  color(m, plank, M.plank);
  m.box([-hw + 0.02, 0.04, hd + 0.08], [-hw + 0.64, 0.13, hd + 0.57]);
  m.beam([-hw + 0.14, 0.12, hd + 0.65], [-hw + 0.36, 0.08, hd + 0.28], [1, 0, 0], 0.045, 0.045);
  basket(m, -hw + 0.3, hd + 0.32, 0.12, r());
  color(m, plank, M.plank); m.box([hw - 0.4, 0.63, hd + 0.17], [hw + 0.24, 0.72, hd + 0.56]);
  for (const x of [hw - 0.3, hw + 0.12]) for (const z of [hd + 0.25, hd + 0.48]) {
    frame(m, x, z, 0.63, Math.min(0.05, localGround(world, p, base, x, z)));
  }
  for (let i = 0; i < 3; i++) {
    color(m, "#c59857", M.plain); m.blob([hw - 0.25 + i * 0.23, 0.78, hd + 0.35], [0.11, 0.075, 0.13], r() * 100, 0);
  }
  lamp(m, L, -0.59, 1.72, hd + 0.04);
  lamp(m, L, -hw - 0.04, 1.72, -hd + 0.38);
  L.push({ x: hw - 0.5, y: 1, z: 0.4, r: 2.8, i: 0.6 });
}

/** Local coordinates; props.ts applies the same world transform to the mesh and the light points. */
export function buildShop(m: MeshBuilder, world: World, p: Prop, lights: Light[]) {
  const type = p.type as ShopType;
  // The site solver limits the ground drop. Short stone footings conceal the remaining grade.
  const { w, d } = SHOP_DIMS[type], c = Math.cos(p.rot), s = Math.sin(p.rot), base = shopBase(world, p);
  let low = base;
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) low = Math.min(low, world.height(p.x + x * c - z * s, p.z + x * s + z * c));
  const drop = Math.max(0.18, base - low + 0.08), onWater = type === "market" && low < WATER_Y - 0.03;
  if (type === "bakery") {
    // Masonry quay, keyed into the land or reaching the seabed. It never rests on timber piles.
    let foot = low;
    for (const x of [-w / 2, 0, w / 2 + 0.8]) for (const z of [-d / 2, 0, d / 2 + 0.74]) {
      foot = Math.min(foot, world.height(p.x + x * c - z * s, p.z + x * s + z * c));
    }
    color(m, stone, M.stone);
    m.box([-w / 2 - 0.1, foot - base - 0.16, -d / 2 - 0.1], [w / 2 + 0.32, 0.02, d / 2 + 0.76]);
  } else if (drop < 0.5 && !onWater && type !== "boatyard") {
    color(m, stone, M.stone); m.box([-w / 2 + 0.06, -drop, -d / 2 + 0.06], [w / 2 - 0.06, -0.2, d / 2 - 0.06]);
  } else {
    const timber = type === "boatyard" || onWater;
    color(m, timber ? dark : stone, timber ? M.plank : M.stone);
    for (const x of [-w / 2 + 0.28, 0, w / 2 - 0.28]) for (const z of [-d / 2 + 0.28, d / 2 - 0.28]) {
      const y = world.height(p.x + x * c - z * s, p.z + x * s + z * c) - base - 0.22;
      if (y < -0.2) m.cyl(x, z, y, -0.12, timber ? 0.11 : 0.23, timber ? 0.1 : 0.2, timber ? 7 : 8);
    }
    color(m, timber ? "#87674b" : "#c4a780", timber ? M.plank : M.stone);
    m.box([-w / 2 + 0.07, -0.34, -d / 2 + 0.07], [w / 2 - 0.07, -0.16, d / 2 - 0.07]);
  }
  if (type === "market") market(m, p, lights, onWater);
  else if (type === "boatyard") boatyard(m, world, p, lights);
  else bakery(m, world, p, lights);
}
