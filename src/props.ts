import * as THREE from "three/webgpu";
import { World, Prop, WATER_Y, N, fbm, isLandmark, landmarkSamples } from "./world";
import { MeshBuilder, V3, M, hexRGB, rng, hsh, add, scl, lerp3, norm, sub } from "./mesh";
import type { Light, Anchor } from "./houses";
import { landingRadius, isStairs, lanternPost } from "./walks";
import { buildHullTavern, buildGrotto, buildLighthouseBase } from "./landmarks";

/** Where a prop stands: the ground, or the deck of a walkway it sits on. */
export function surfaceAt(world: World, x: number, z: number) {
  let y = world.height(Math.min(N, Math.max(0, x)), Math.min(N, Math.max(0, z)));
  for (const n of world.nodes.values()) if (Math.hypot(n.x - x, n.z - z) < landingRadius(world, n) * 0.9 && n.y > y) y = n.y;
  for (const e of world.edges.values()) {
    const a = world.nodes.get(e.a), b = world.nodes.get(e.b);
    if (!a || !b || e.style === "rope" || isStairs(a, b)) continue;
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
    if (L2 < 1e-4) continue;
    const t = ((x - a.x) * dx + (z - a.z) * dz) / L2;
    if (t < 0 || t > 1) continue;
    const d = Math.abs((x - a.x) * dz - (z - a.z) * dx) / Math.sqrt(L2);
    if (d < e.width / 2) { const dy = a.y + (b.y - a.y) * t; if (dy > y) y = dy; }
  }
  return y;
}

/** Local points a prop stands on: posts for the lines, a small ring for heaps, the centre for the rest. */
function footSamples(type: string): [number, number][] {
  if (type === "laundry") return [[0, 0], [-0.9, 0], [0.9, 0]];
  if (type === "nets") return [[0, 0], [-0.85, 0], [0.85, 0]];
  if (type === "crates" || type === "barrels") return [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]];
  return [[0, 0]];
}
/** A placed prop's base: the highest deck or ground under any of its feet, so a walkway built beneath lifts it. */
export function propBase(world: World, p: Prop) {
  const c = Math.cos(p.rot), s = Math.sin(p.rot), sc = p.scale ?? 1;
  let y = -Infinity;
  for (const [lx, lz] of footSamples(p.type)) y = Math.max(y, surfaceAt(world, p.x + (lx * c - lz * s) * sc, p.z + (lx * s + lz * c) * sc));
  return y;
}

/** Palm trunk shape from its seed and options (shared by the mesh and the walkway cover test). */
function palmShape(p: Prop) {
  const r = rng(p.seed);
  const h0 = 2.4 + r() * 1.2, lean0 = 0.4 + r() * 0.5;
  return { h: h0 * +(p.opts?.height ?? 1), lean: p.opts?.lean !== undefined ? +p.opts.lean : lean0 };
}
/** Would this palm's leaning trunk pass through a walkway deck? */
export function palmPierces(world: World, p: Prop) {
  const { h, lean } = palmShape(p), sc = p.scale ?? 1, c = Math.cos(p.rot), s = Math.sin(p.rot);
  const y0 = groundBase(world, p.x, p.z, 0.16 * sc);
  for (let i = 1; i <= 10; i++) {
    const t = i / 10, off = lean * t * t * sc, x = p.x + c * off, z = p.z + s * off, y = y0 + t * h * sc;
    for (const e of world.edges.values()) {
      const a = world.nodes.get(e.a), b = world.nodes.get(e.b); if (!a || !b) continue;
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-6;
      const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
      if (Math.hypot(a.x + dx * u - x, a.z + dz * u - z) > e.width / 2 + 0.15) continue;
      const dy = a.y + (b.y - a.y) * u;
      if (Math.abs(dy - y) < 0.35) return true;
    }
  }
  return false;
}

export interface PropBuild { lights: Light[]; foam: { x: number; z: number; r: number }[] }

export const PROP_INFO: Record<string, { label: string; water?: boolean; big?: boolean; r: number }> = {
  palm: { label: "Palm", r: 0.5 }, bougainvillea: { label: "Bougainvillea", r: 0.6 }, scrub: { label: "Scrub", r: 0.45 },
  rock: { label: "Rock", r: 0.5 }, barrels: { label: "Barrels", r: 0.45 }, crates: { label: "Crates", r: 0.5 },
  lantern: { label: "Lantern", r: 0.3 }, nets: { label: "Drying nets", r: 0.9 }, laundry: { label: "Laundry", r: 0.9 },
  crane: { label: "Crane", r: 0.8 },
  rowboat: { label: "Rowboat", water: true, r: 1.0 }, sloop: { label: "Sloop", water: true, r: 1.9 },
  hull: { label: "Hull tavern", big: true, r: 4.2 }, grotto: { label: "Sea grotto", big: true, r: 3.4 }, lighthouse: { label: "Lighthouse", big: true, r: 1.4 },
};

/** Trees, shrubs and rocks are lesser objects: anything built over them hides them instead of being blocked. */
export const isGreenery = (t: string) => t === "palm" || t === "bougainvillea" || t === "scrub" || t === "rock";
/** Is this greenery covered by a walkway, a house or a landmark? Then it isn't drawn (it comes back if that goes). */
export function greeneryHidden(world: World, p: Prop) {
  if (!isGreenery(p.type)) return false;
  const r = (p.type === "palm" ? 0.2 : 0.35) * (p.scale ?? 1);
  if (world.houseAt(p.x, p.z, r + 0.1)) return true;
  for (const n of world.nodes.values()) if (world.edgesOf(n.id).length && Math.hypot(n.x - p.x, n.z - p.z) < landingRadius(world, n) + r) return true;
  for (const e of world.edges.values()) {
    const a = world.nodes.get(e.a), b = world.nodes.get(e.b); if (!a || !b) continue;
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-6;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2));
    if (Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z) < e.width / 2 + r + 0.1) return true;
  }
  for (const o of world.props.values()) if (isLandmark(o.type) && landmarkSamples(o).some(([x, z]) => Math.hypot(x - p.x, z - p.z) < 0.55 + r)) return true;
  if (p.type === "palm" && palmPierces(world, p)) return true;
  return false;
}
/** Greenery stands on the ground (never on a deck), with its base sunk to the low side so nothing floats on a slope. */
export function groundBase(world: World, x: number, z: number, r: number) {
  let lo = world.height(Math.min(N, Math.max(0, x)), Math.min(N, Math.max(0, z)));
  for (let k = 0; k < 8; k++) lo = Math.min(lo, world.height(Math.min(N, Math.max(0, x + Math.cos(k * 0.785) * r)), Math.min(N, Math.max(0, z + Math.sin(k * 0.785) * r))));
  return lo - 0.06;
}

/** Static props merge into one mesh; boats are separate so they can bob. */
export function buildProps(world: World, mb: MeshBuilder, out: PropBuild) {
  for (const p of world.props.values()) {
    if (PROP_INFO[p.type]?.water || greeneryHidden(world, p)) continue;
    buildOneProp(world, mb, p, out);
  }
}
export function buildOneProp(world: World, mb: MeshBuilder, p: Prop, out: PropBuild) {
  {
    mb.setOwner(`p:${p.id}`);
    const y = p.type === "grotto" ? WATER_Y : isGreenery(p.type) ? groundBase(world, p.x, p.z, (p.type === "palm" ? 0.16 : 0.3) * (p.scale ?? 1)) : propBase(world, p);
    const c = Math.cos(p.rot), s = Math.sin(p.rot), sc = p.scale ?? 1;
    /** Local height of the surface under local point (lx, lz), relative to the base (<= 0): posts reach down to it. */
    foot = (lx: number, lz: number) => Math.min(0, (surfaceAt(world, p.x + (lx * c - lz * s) * sc, p.z + (lx * s + lz * c) * sc) - y) / sc);
    // build in local space (x right, z forward), rotate + translate
    mb.xf = (q: V3) => [p.x + (q[0] * c - q[2] * s) * sc, y + q[1] * sc, p.z + (q[0] * s + q[2] * c) * sc];
    const L: Light[] = [];
    if (p.type === "hull") { buildHullTavern(mb, world, p, L); out.lights.push(...L); mb.xf = null; return; }
    if (p.type === "grotto") buildGrotto(mb, world, p, L);
    else { if (p.type === "lighthouse") buildLighthouseBase(mb, world, p, y); propMesh(mb, p, L, out, y); }
    for (const l of L) { const w = mb.xf([l.x, l.y, l.z]); out.lights.push({ ...l, x: w[0], y: w[1], z: w[2] }); }
    mb.xf = null;
  }
}

let foot = (_lx: number, _lz: number) => 0;
/** A line strung between posts at ±h: a post that would hang far below the base (off the deck it stands on)
 *  slides inward until it finds the deck, shortening the line. Returns the new centre and scale along x. */
function lineSpan(h: number): [number, number] {
  const DROP = -0.45, MIN = 0.5;
  const slide = (from: number, to: number) => {
    if (foot(from, 0) >= DROP) return from;
    for (let i = 1; i <= 40; i++) { const x = from + (to - from) * i / 40; if (foot(x, 0) >= -0.1) return x; }
    return from;
  };
  const a = slide(-h, h), b = slide(h, -h);
  if (b - a < MIN) return [0, 1]; // too little deck to stand on: keep the long post
  return [(a + b) / 2, (b - a) / (2 * h)];
}
function propMesh(mb: MeshBuilder, p: Prop, L: Light[], out: PropBuild, y: number) {
  const r = rng(p.seed);
  switch (p.type) {
    case "palm": palm(mb, r, p); break;
    case "bougainvillea": {
      for (let i = 0; i < 4; i++) { mb.paint(hexRGB(i % 2 ? "#6c8743" : "#5d7a3c"), M.leaf); mb.blob([(r() - 0.5) * 0.6, 0.25 + r() * 0.35, (r() - 0.5) * 0.6], [0.35, 0.3, 0.35], r() * 99, 1); }
      for (let i = 0; i < 9; i++) { mb.paint(hexRGB(["#c9577a", "#d36f8f", "#b84a6a", "#e08aa0"][i % 4]), M.leaf); mb.blob([(r() - 0.5) * 0.9, 0.3 + r() * 0.55, (r() - 0.5) * 0.9], [0.16, 0.13, 0.16], r() * 99, 0); }
      break;
    }
    case "scrub": for (let i = 0; i < 3; i++) { mb.paint(hexRGB(["#7b8a4c", "#8e9656", "#6d7d45"][i]), M.leaf); mb.blob([(r() - 0.5) * 0.5, 0.15 + r() * 0.1, (r() - 0.5) * 0.5], [0.25, 0.2, 0.25], r() * 99, 0); } break;
    case "rock": mb.paint(hexRGB("#d9a36c"), M.rock); mb.blob([0, 0.15, 0], [0.5, 0.35, 0.42], r() * 99, 1); mb.blob([0.35, 0.05, 0.25], [0.25, 0.18, 0.22], r() * 99, 0); break;
    case "barrels": for (let i = 0; i < 3; i++) { const a = i * 2.1 + r(); barrel(mb, Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0, r); } if (r() < 0.5) barrel(mb, 0, 0, 0.5, r); break;
    case "crates": {
      const cols = ["#9a7650", "#b08a5e", "#8a6a48"];
      mb.paint(hexRGB(cols[0]), M.plank); mb.box([-0.3, 0, -0.3], [0.2, 0.5, 0.2]);
      mb.paint(hexRGB(cols[1]), M.plank); mb.box([0.22, 0, -0.2], [0.6, 0.38, 0.18]);
      mb.paint(hexRGB(cols[2]), M.plank); mb.box([-0.22, 0.5, -0.24], [0.12, 0.84, 0.1]);
      mb.paint(hexRGB("#c9b48a"), M.cloth); mb.box([0.24, 0.38, -0.18], [0.58, 0.44, 0.16]);
      break;
    }
    case "lantern": lanternPost(mb, 0, 0, 0, { lights: L }); break;
    case "nets": {
      const [m, k] = lineSpan(0.85), X = (x: number) => m + x * k;
      mb.paint(hexRGB("#6b4a33"), M.plank);
      for (const x of [-0.85, 0.85]) mb.cyl(X(x), 0, foot(X(x), 0) - 0.04, 1.3, 0.05, 0.045, 6);
      mb.beam([X(-0.9), 1.25, 0], [X(0.9), 1.25, 0], [0, 0, 1], 0.035, 0.035);
      for (let j = 0; j < 2; j++) {
        const zz = j ? 0.06 : -0.06;
        const pts: V3[] = [];
        for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push([X(-0.85 + 1.7 * t), 1.2 - 0.25 - Math.sin(Math.PI * t) * 0.25 - j * 0.1, zz]); }
        mb.paint(hexRGB(j ? "#5f6e57" : "#7a6a4e"), M.cloth);
        for (let i = 0; i < 8; i++) mb.quad([[pts[i][0], 1.22, zz], [pts[i + 1][0], 1.22, zz], pts[i + 1], pts[i]], [0, 0, j ? 1 : -1]);
        for (let i = 0; i < 8; i++) mb.quad([[pts[i][0], 1.22, zz], [pts[i + 1][0], 1.22, zz], pts[i + 1], pts[i]], [0, 0, j ? -1 : 1]);
      }
      for (let i = 0; i < 4; i++) { mb.paint(hexRGB(i % 2 ? "#e08a4a" : "#efe4cc"), M.plain); mb.blob([X(-0.6 + i * 0.4), 0.78 - Math.sin(Math.PI * (i + 1) / 5) * 0.2, 0.1], [0.07, 0.07, 0.07], i, 0); }
      break;
    }
    case "laundry": {
      const [m, k] = lineSpan(0.9), X = (x: number) => m + x * k;
      mb.paint(hexRGB("#6b4a33"), M.plank);
      for (const x of [-0.9, 0.9]) mb.cyl(X(x), 0, foot(X(x), 0) - 0.04, 1.5, 0.04, 0.035, 6);
      const rope: V3[] = []; for (let i = 0; i <= 10; i++) { const t = i / 10; rope.push([X(-0.9 + 1.8 * t), 1.42 - Math.sin(Math.PI * t) * 0.12, 0]); }
      mb.paint(hexRGB("#d8c8a8"), M.cloth); mb.tube(rope, 0.012, 4);
      const cloth = ["#e9dcbc", "#3f8783", "#c96b43", "#dca34e", "#9fb3c8", "#f1ead8"];
      for (let i = 0; i < 5; i++) {
        const t = 0.12 + i * 0.19, x = X(-0.9 + 1.8 * t), yy = 1.42 - Math.sin(Math.PI * t) * 0.12;
        const w = (0.14 + r() * 0.06) * k, hh = 0.25 + r() * 0.2;
        mb.paint(hexRGB(cloth[Math.floor(r() * cloth.length)]), M.cloth);
        mb.quad([[x - w, yy, 0], [x + w, yy, 0], [x + w, yy - hh, 0.02], [x - w, yy - hh, 0.02]], [0, 0, 1]);
        mb.quad([[x - w, yy, 0], [x + w, yy, 0], [x + w, yy - hh, 0.02], [x - w, yy - hh, 0.02]], [0, 0, -1]);
      }
      break;
    }
    case "crane": {
      mb.paint(hexRGB("#6b4a33"), M.plank);
      mb.cyl(0, 0, -0.1, 2.6, 0.1, 0.09, 8);
      mb.beam([0, 2.4, 0], [1.9, 2.5, 0], [0, 0, 1], 0.06, 0.07);
      mb.beam([0, 1.6, 0], [1.2, 2.45, 0], [0, 0, 1], 0.04, 0.04);
      mb.paint(hexRGB("#3b332c"), M.metal); mb.cyl(1.82, 0, 2.3, 2.45, 0.08, 0.08, 8);
      mb.paint(hexRGB("#b89a70"), M.cloth); mb.beam([1.82, 2.3, 0], [1.82, 1.1, 0], [0, 0, 1], 0.012, 0.012);
      mb.paint(hexRGB("#6f6048"), M.cloth); mb.blob([1.82, 0.85, 0], [0.32, 0.3, 0.3], 7, 1);
      mb.paint(hexRGB("#9a7650"), M.plank); mb.box([1.62, 0.62, -0.18], [2.0, 0.95, 0.16]);
      break;
    }
    case "lighthouse": lighthouse(mb, L); break;
  }
  void out;
}

export function barrel(mb: MeshBuilder, x: number, z: number, y0: number, r: () => number) {
  mb.paint(hexRGB(r() < 0.5 ? "#8a5f3c" : "#9c6e45"), M.plank);
  mb.cyl(x, z, y0, y0 + 0.24, 0.17, 0.2, 9, false); mb.cyl(x, z, y0 + 0.24, y0 + 0.48, 0.2, 0.17, 9, true);
  mb.paint(hexRGB("#3b332c"), M.metal);
  for (const hy of [0.07, 0.41]) mb.cyl(x, z, y0 + hy, y0 + hy + 0.03, 0.185 + (hy < 0.2 ? 0 : 0), 0.19, 9, false);
}

function palm(mb: MeshBuilder, r: () => number, p: Prop) {
  r(); r(); r();
  const { h, lean } = palmShape(p), dir = 0; // leans along local +x; the prop's rotation aims it
  const pts: V3[] = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; const off = lean * t * t; pts.push([Math.cos(dir) * off, t * h, Math.sin(dir) * off]); }
  for (let i = 0; i < 10; i++) { mb.paint(hexRGB(i % 2 ? "#8b7358" : "#7a6450"), M.plank); mb.tube([pts[i], pts[i + 1]], (t: number) => 0.13 - (i + t) * 0.006, 7); }
  const top = pts[10];
  mb.paint(hexRGB("#5c4a38"), M.plain); mb.blob(top, [0.16, 0.14, 0.16], 3, 0);
  const nf = 8 + Math.floor(r() * 3);
  for (let f = 0; f < nf; f++) {
    const a = (f / nf) * Math.PI * 2 + r() * 0.3, len = 1.3 + r() * 0.5, lift = 0.25 + r() * 0.3;
    const dx = Math.cos(a), dz = Math.sin(a);
    const spine: V3[] = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; spine.push(add(top, [dx * len * t, lift * t - 1.1 * t * t * t * len * 0.6, dz * len * t])); }
    const side: V3 = [-dz, 0, dx];
    mb.paint(hexRGB(f % 2 ? "#6f8a45" : "#809a4c"), M.leaf);
    for (let i = 0; i < 6; i++) {
      const w0 = Math.sin(Math.PI * (i / 6 * 0.9 + 0.05)) * 0.32, w1 = Math.sin(Math.PI * ((i + 1) / 6 * 0.9 + 0.05)) * 0.32;
      const a0 = spine[i], a1 = spine[i + 1];
      for (const sgn of [-1, 1]) {
        const q: V3[] = [a0, a1, add(add(a1, scl(side, sgn * w1)), [0, -0.1, 0]), add(add(a0, scl(side, sgn * w0)), [0, -0.1, 0])];
        mb.quad(q, [0, 1, 0]); mb.quad(q, [0, -1, 0]);
      }
    }
  }
  mb.paint(hexRGB("#6b5a3a"), M.plain);
  for (let i = 0; i < 3; i++) mb.blob(add(top, [(r() - 0.5) * 0.2, -0.15, (r() - 0.5) * 0.2]), [0.08, 0.08, 0.08], i, 0);
}

/** Lofted hull: shared by boats and the beached tavern. Returns nothing; draws outer + inner shell + gunwale. */
/** A depth-only lid across the hull at the waterline: drawn after the boat but before the water, it keeps the sea out of the hull. */
const hullMaskMat = (() => { const m = new THREE.MeshBasicNodeMaterial(); m.colorWrite = false; return m; })();
export function hullMask(len: number, wid: number, dep: number, y: number): THREE.Mesh {
  const NL = 24, pts: [number, number][] = [];
  for (let i = 0; i <= NL; i++) {
    const t = i / NL * 2 - 1;
    const hwid = wid / 2 * Math.pow(Math.max(0, 1 - (t > 0 ? t * t : t * t * 0.55)), 0.55);
    const d = dep * (1 - 0.25 * t * t);
    const sheer = 0.12 * t * t * dep / 0.35;
    const sN = (sheer - y) / d;
    pts.push([hwid * 0.97 * Math.sqrt(Math.max(0, 1 - sN * sN)), t * len / 2]);
  }
  const pos: number[] = [];
  for (let i = 0; i < NL; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    pos.push(-x0, y, z0, x1, y, z1, x0, y, z0, -x0, y, z0, -x1, y, z1, x1, y, z1); // wound to face up
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g, hullMaskMat);
  m.renderOrder = 1; m.castShadow = false; m.receiveShadow = false;
  return m;
}
/** Inner half-width of the lofted hull at station z and height y (same section as `hull`, 0 outside it). */
export function hullHalfWidth(len: number, wid: number, dep: number, z: number, y: number) {
  const t = Math.max(-1, Math.min(1, z / (len / 2)));
  const hwid = wid / 2 * Math.pow(Math.max(0, 1 - (t > 0 ? t * t : t * t * 0.55)), 0.55);
  const d = dep * (1 - 0.25 * t * t);
  const sN = (0.12 * t * t * dep / 0.35 - y) / d;
  return hwid * Math.sqrt(Math.max(0, 1 - sN * sN));
}
/** A plank slab from y0 to y1 between stations z0..z1, its outline following the inside of the hull (optionally capped at maxHw). */
export function hullDeck(mb: MeshBuilder, len: number, wid: number, dep: number, y0: number, y1: number, z0: number, z1: number, maxHw = Infinity, inset = 0.04) {
  const n = Math.max(4, Math.ceil((z1 - z0) / 0.4));
  const st = Array.from({ length: n + 1 }, (_, i) => {
    const z = z0 + (i / n) * (z1 - z0);
    return [z, Math.max(0, Math.min(maxHw, hullHalfWidth(len, wid, dep, z, y0) - inset, hullHalfWidth(len, wid, dep, z, y1) - inset))] as const;
  });
  for (let i = 0; i < n; i++) {
    const [za, wa] = st[i], [zb, wb] = st[i + 1];
    mb.quad([[-wa, y1, za], [wa, y1, za], [wb, y1, zb], [-wb, y1, zb]], [0, 1, 0]);
    mb.quad([[-wa, y0, za], [wa, y0, za], [wb, y0, zb], [-wb, y0, zb]], [0, -1, 0]);
    for (const sg of [-1, 1]) mb.quad([[sg * wa, y0, za], [sg * wb, y0, zb], [sg * wb, y1, zb], [sg * wa, y1, za]], [sg, 0, 0]);
  }
  for (const [[z, w], sg] of [[st[0], -1], [st[n], 1]] as const) if (w > 0) mb.quad([[-w, y0, z], [w, y0, z], [w, y1, z], [-w, y1, z]], [0, 0, sg]);
}
export function hull(mb: MeshBuilder, len: number, wid: number, dep: number, paint: V3, inner: V3, stripe?: V3) {
  const NL = 12, NA = 7;
  const ring = (i: number): V3[] => {
    const t = i / NL * 2 - 1; // -1 stern .. 1 bow
    const hwid = wid / 2 * Math.pow(Math.max(0, 1 - (t > 0 ? t * t : t * t * 0.55)), 0.55);
    const d = dep * (1 - 0.25 * t * t);
    const sheer = 0.12 * t * t * dep / 0.35;
    const pts: V3[] = [];
    for (let k = 0; k <= NA; k++) {
      const th = (k / NA) * Math.PI;
      pts.push([Math.cos(th) * hwid, -Math.sin(th) * d + sheer, t * len / 2]);
    }
    return pts;
  };
  const rings = Array.from({ length: NL + 1 }, (_, i) => ring(i));
  for (let i = 0; i < NL; i++) for (let k = 0; k < NA; k++) {
    const a = rings[i][k], b = rings[i][k + 1], c = rings[i + 1][k + 1], d = rings[i + 1][k];
    const mid = lerp3(lerp3(a, b, 0.5), lerp3(c, d, 0.5), 0.5);
    const out: V3 = [mid[0], mid[1] + dep * 0.6, 0];
    const top = k === 0 || k === NA - 1;
    mb.paint(stripe && top ? stripe : paint, M.plank);
    mb.quad([a, b, c, d], out, [[a[2], a[1] * 1.0 + k * 0.2], [b[2], b[1] + (k + 1) * 0.2], [c[2], c[1] + (k + 1) * 0.2], [d[2], d[1] + k * 0.2]]);
    mb.paint(inner, M.plank);
    mb.quad([a, b, c, d], scl(out, -1));
  }
  // transom at the stern
  mb.paint(paint, M.plank);
  const st = rings[0];
  for (let k = 0; k < NA; k++) mb.tri([[0, st[0][1], st[0][2]], st[k], st[k + 1]], [0, 0, -1]);
  mb.paint(inner, M.plank); // the transom seen from inside the boat
  for (let k = 0; k < NA; k++) mb.tri([[0, st[0][1], st[0][2] + 0.02], [st[k][0], st[k][1], st[k][2] + 0.02], [st[k + 1][0], st[k + 1][1], st[k + 1][2] + 0.02]], [0, 0, 1]);
  mb.paint(hexRGB("#6b4a33"), M.plank);
  for (const side of [0, NA]) mb.tube(rings.map(rr => [rr[side][0], rr[side][1] + 0.02, rr[side][2]] as V3), 0.035, 4);
}

function lighthouse(mb: MeshBuilder, L: Light[]) {
  const h = 6.2;
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const y0 = (i / bands) * h, y1 = ((i + 1) / bands) * h;
    const r0 = 0.95 - 0.3 * (i / bands), r1 = 0.95 - 0.3 * ((i + 1) / bands);
    mb.paint(hexRGB(i % 2 ? "#c0643f" : "#f1ead8"), M.plaster);
    mb.cyl(0, 0, y0, y1, r0, r1, 14, false);
  }
  mb.paint(hexRGB("#b9a78b"), M.stone); mb.cyl(0, 0, -0.4, 0.5, 1.15, 1.1, 14);
  mb.paint(hexRGB("#3b332c"), M.metal); mb.cyl(0, 0, h, h + 0.12, 0.95, 0.95, 14);
  for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; mb.cyl(Math.cos(a) * 0.9, Math.sin(a) * 0.9, h + 0.12, h + 0.55, 0.02, 0.02, 4, false); }
  mb.paint(hexRGB("#fff0c8"), M.lamp); mb.cyl(0, 0, h + 0.12, h + 1.0, 0.45, 0.45, 10);
  mb.paint(hexRGB("#3b332c"), M.metal); mb.cyl(0, 0, h + 1.0, h + 1.1, 0.6, 0.6, 12);
  mb.paint(hexRGB("#c0643f"), M.tile); mb.cyl(0, 0, h + 1.1, h + 1.7, 0.6, 0.05, 12);
  mb.paint([0.2, 0.3, 0.33], M.glass);
  for (let i = 1; i < 4; i++) { const a = i * 2.1; const y = i * 1.4; mb.box([Math.cos(a) * 0.82 - 0.1, y, Math.sin(a) * 0.82 - 0.1], [Math.cos(a) * 0.82 + 0.1, y + 0.4, Math.sin(a) * 0.82 + 0.1]); }
  L.push({ x: 0, y: h + 0.5, z: 0, r: 5.5, i: 1.2 });
}

// ---------- boats: separate bobbing meshes ----------
export interface Boat { mesh: THREE.Mesh; phase: number; x: number; z: number; rot: number; big: boolean }
/** Hulls are built with the gunwale at y≈0 and the keel below; lift them so about half the hull rides above the water. */
export const boatFreeboard = (type: string) => type === "sloop" ? 0.32 : 0.17;
export function buildBoat(p: Prop, mat: THREE.Material): Boat {
  const mb = new MeshBuilder();
  mb.setOwner(`p:${p.id}`);
  const r = rng(p.seed);
  const cols = ["#3f8783", "#c0643f", "#e9dcbc", "#2e6a6c", "#d9a84e", "#86b3a4"];
  const paint = hexRGB(cols[Math.floor(r() * cols.length)]);
  const big = p.type === "sloop";
  if (!big) {
    hull(mb, 1.9, 0.78, 0.3, paint, hexRGB("#8a6a48"), hexRGB("#efe4cc"));
    mb.paint(hexRGB("#9c7b58"), M.plank);
    for (const z of [-0.45, 0.1, 0.5]) mb.box([-0.32, -0.08, z - 0.08], [0.32, -0.03, z + 0.08]);
    mb.paint(hexRGB("#b08a5e"), M.plank);
    for (const s of [-1, 1]) mb.beam([s * 0.3, 0.02, 0.05], [s * 0.75, -0.25, -0.75], [0, 1, 0], 0.025, 0.012);
  } else {
    hull(mb, 3.8, 1.35, 0.6, paint, hexRGB("#8a6a48"), hexRGB("#efe4cc"));
    mb.paint(hexRGB("#9c7b58"), M.plank); mb.box([-0.55, -0.05, -1.4], [0.55, 0.02, 1.2]);
    mb.paint(hexRGB("#6b4a33"), M.plank); mb.cyl(0, 0.35, 0, 4.1, 0.06, 0.045, 7);
    mb.beam([0, 0.7, 0.35], [0, 0.72, -1.7], [1, 0, 0], 0.035, 0.035);
    mb.paint(hexRGB("#ece0c4"), M.cloth);
    const sail: V3[] = [[0, 4.0, 0.33], [0, 0.78, 0.33], [0.05, 0.78, -1.65]];
    for (let i = 0; i < 6; i++) {
      const t0 = i / 6, t1 = (i + 1) / 6;
      const a = lerp3(sail[0], sail[1], t0), b = lerp3(sail[0], sail[1], t1), c = lerp3(sail[0], sail[2], t1), d = lerp3(sail[0], sail[2], t0);
      const bel = (t: number): V3 => [0.18 * Math.sin(Math.PI * t) * t, 0, 0];
      const q: V3[] = [a, b, add(c, bel(t1)), add(d, bel(t0))];
      mb.quad(q, [1, 0, 0]); mb.quad(q, [-1, 0, 0]);
    }
    mb.paint(hexRGB("#e0d2b2"), M.cloth);
    const jib: V3[] = [[0, 3.8, 0.38], [0, 0.4, 1.85], [0.02, 0.6, 0.45]];
    mb.tri(jib, [1, 0, 0]); mb.tri(jib, [-1, 0, 0]);
    mb.paint(hexRGB("#c96b43"), M.cloth);
    mb.tri([[0, 4.1, 0.35], [0, 3.92, 0.35], [0.02, 4.0, -0.35]], [1, 0, 0]); mb.tri([[0, 4.1, 0.35], [0, 3.92, 0.35], [0.02, 4.0, -0.35]], [-1, 0, 0]);
  }
  const mesh = new THREE.Mesh(mb.toGeometry(), mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.owners = mb.owners; mesh.userData.triOwner = mb.triOwner;
  // keep the sea out of the hull: a depth-only lid a little above the waterline
  const fb = boatFreeboard(p.type);
  mesh.add(big ? hullMask(3.8, 1.35, 0.6, -fb + 0.13) : hullMask(1.9, 0.78, 0.3, -fb + 0.1));
  return { mesh, phase: r() * 10, x: p.x, z: p.z, rot: p.rot, big };
}
export function updateBoat(b: Boat, t: number) {
  const s = b.big ? 0.6 : 1;
  b.mesh.position.set(b.x, WATER_Y + (b.big ? boatFreeboard("sloop") : boatFreeboard("rowboat")) + Math.sin(t * 1.3 + b.phase) * 0.035 * s, b.z);
  b.mesh.rotation.set(Math.sin(t * 0.9 + b.phase) * 0.02 * s, -b.rot + Math.sin(t * 0.3 + b.phase) * 0.03, Math.sin(t * 1.1 + b.phase * 1.7) * 0.05 * s);
}

// ---------- strings of lanterns between neighbouring houses ----------
export function stringLights(anchors: Anchor[], mb: MeshBuilder, out: { lights: Light[] }) {
  const used = new Map<string, number>();
  const pairs: [Anchor, Anchor, number][] = [];
  for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) {
    const a = anchors[i], b = anchors[j];
    if (a.house === b.house) continue;
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d < 2.2 || d > 6.5 || Math.abs(a.y - b.y) > 1.6) continue;
    pairs.push([a, b, d]);
  }
  pairs.sort((p, q) => p[2] - q[2]);
  const done = new Set<string>();
  mb.setOwner("strings");
  for (const [a, b] of pairs) {
    const key = [a.house, b.house].sort().join("|");
    if (done.has(key) || (used.get(a.house) ?? 0) >= 2 || (used.get(b.house) ?? 0) >= 2) continue;
    done.add(key); used.set(a.house, (used.get(a.house) ?? 0) + 1); used.set(b.house, (used.get(b.house) ?? 0) + 1);
    const A: V3 = [a.x, a.y, a.z], B: V3 = [b.x, b.y, b.z];
    const L = Math.hypot(a.x - b.x, a.z - b.z);
    const sag = 0.25 + L * 0.06;
    const pts: V3[] = [];
    const n = 14;
    for (let i = 0; i <= n; i++) { const t = i / n; const p = lerp3(A, B, t); pts.push([p[0], p[1] - Math.sin(Math.PI * t) * sag, p[2]]); }
    mb.paint(hexRGB("#3b332c"), M.cloth); mb.tube(pts, 0.008, 3);
    const k = Math.max(3, Math.floor(L / 0.55));
    for (let i = 1; i < k; i++) {
      const t = i / k;
      const p = lerp3(A, B, t); p[1] -= Math.sin(Math.PI * t) * sag + 0.06;
      mb.paint(hexRGB(["#ffcf80", "#ffb070", "#ffe0a0", "#ff9f6a"][i % 4]), M.lamp);
      mb.blob(p, [0.045, 0.06, 0.045], i, 0);
    }
    const mid = lerp3(A, B, 0.5); mid[1] -= sag;
    out.lights.push({ x: mid[0], y: mid[1], z: mid[2], r: L * 0.55, i: 0.35 });
  }
  void norm; void sub;
}

// ---------- natural scatter: scrub, rocks, agaves and stone pines on open ground ----------
const hash2 = (i: number, j: number, k: number) => { const v = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return v - Math.floor(v); };
export function buildScatter(world: World, mb: MeshBuilder) {
  mb.setOwner("scatter");
  const blocked = (x: number, z: number, r: number) => {
    if (world.houseAt(x, z, r + 0.6)) return true;
    for (const p of world.props.values()) {
      if (isLandmark(p.type)) { for (const [sx, sz] of landmarkSamples(p)) if (Math.hypot(sx - x, sz - z) < r + 0.55) return true; }
      else if (Math.hypot(p.x - x, p.z - z) < (PROP_INFO[p.type]?.r ?? 0.5) + r + 0.3) return true;
    }
    for (const n of world.nodes.values()) if (Math.hypot(n.x - x, n.z - z) < 1.2 + r) return true;
    for (const e of world.edges.values()) {
      const a = world.nodes.get(e.a), b = world.nodes.get(e.b); if (!a || !b) continue;
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz; if (L2 < 1e-3) continue;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
      if (Math.hypot(a.x + dx * t - x, a.z + dz * t - z) < e.width / 2 + r + 0.3) return true;
    }
    return false;
  };
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const h = hash2(i, j, 1);
    const lvl = world.level(i, j);
    const green = world.paint[(j * N + i) * 4 + 2] / 255, paved = (world.paint[(j * N + i) * 4] + world.paint[(j * N + i) * 4 + 1]) / 255;
    if (paved > 0.3) continue;
    const top = lvl >= 13, low = lvl >= 7 && lvl < 13;
    const dens = green > 0.4 ? 0.3 : top ? 0.16 : low ? 0.06 : 0;
    if (h > dens) continue;
    const x = i + 0.2 + hash2(i, j, 2) * 0.6, z = j + 0.2 + hash2(i, j, 3) * 0.6;
    const y = world.height(x, z);
    const e = 0.4;
    const slope = Math.max(Math.abs(world.height(x + e, z) - world.height(x - e, z)), Math.abs(world.height(x, z + e) - world.height(x, z - e)));
    if (slope > 0.12 || y < WATER_Y + 0.9) continue;
    const pick = hash2(i, j, 4);
    const kind = green > 0.4 ? (pick < 0.3 ? "bloom" : "scrub") : top ? (pick < 0.08 ? "pine" : pick < 0.2 ? "agave" : pick < 0.32 ? "rock" : "scrub") : (pick < 0.15 ? "agave" : pick < 0.25 ? "rock" : "scrub");
    const r = kind === "pine" ? 1.3 : 0.4;
    if (blocked(x, z, r)) continue;
    const rr = rng(h * 1000 + i);
    const sc = 0.7 + rr() * 0.6;
    const prev = mb.xf;
    const rot = rr() * Math.PI * 2, c = Math.cos(rot), s = Math.sin(rot);
    mb.xf = (q: V3) => [x + (q[0] * c - q[2] * s) * sc, y + q[1] * sc - 0.03, z + (q[0] * s + q[2] * c) * sc];
    if (kind === "scrub" || kind === "bloom") {
      const n = 2 + Math.floor(rr() * 2);
      for (let k = 0; k < n; k++) { mb.paint(hexRGB(["#7b8a4c", "#8e9656", "#6d7d45", "#94904f"][Math.floor(rr() * 4)]), M.leaf); mb.blob([(rr() - 0.5) * 0.5, 0.12 + rr() * 0.08, (rr() - 0.5) * 0.5], [0.22, 0.17, 0.22], rr() * 99, 0); }
      if (kind === "bloom") for (let k = 0; k < 3; k++) { mb.paint(hexRGB(["#c9577a", "#d36f8f", "#e08a4a"][k]), M.leaf); mb.blob([(rr() - 0.5) * 0.5, 0.26, (rr() - 0.5) * 0.5], [0.08, 0.06, 0.08], rr() * 99, 0); }
    } else if (kind === "rock") {
      mb.paint(hexRGB("#d9a36c"), M.rock); mb.blob([0, 0.08, 0], [0.34, 0.22, 0.28], rr() * 99, 0);
    } else if (kind === "agave") {
      mb.paint(hexRGB(rr() < 0.5 ? "#7d9a8a" : "#8aa38a"), M.leaf);
      const nl = 9;
      for (let k = 0; k < nl; k++) {
        const a = (k / nl) * Math.PI * 2, len = 0.45 + rr() * 0.15, up = 0.25 + rr() * 0.25;
        const dx = Math.cos(a), dz = Math.sin(a);
        const tip: V3 = [dx * len, up, dz * len], b0: V3 = [-dz * 0.07, 0.02, dx * 0.07], b1: V3 = [dz * 0.07, 0.02, -dx * 0.07];
        mb.tri([b0, b1, tip], [dx, 0.6, dz]); mb.tri([b0, b1, tip], [-dx, -0.6, -dz]);
      }
    } else {
      // stone pine: leaning trunk, flat parasol canopy
      const lean = 0.5 + rr() * 0.5, H = 2.6 + rr() * 1.0;
      const pts: V3[] = [];
      for (let k = 0; k <= 6; k++) { const t = k / 6; pts.push([lean * t * t, t * H, 0]); }
      mb.paint(hexRGB("#7a5a44"), M.plank); mb.tube(pts, (t: number) => 0.13 - t * 0.06, 6);
      mb.beam(pts[4], [lean * 0.4 - 0.7, H * 0.95, 0.3], [0, 0, 1], 0.04, 0.04);
      const top = pts[6];
      const cols = ["#56703a", "#62793f", "#4d6636"];
      for (let k = 0; k < 5; k++) {
        const a = k * 1.3 + rr(), d = k === 0 ? 0 : 0.6 + rr() * 0.3;
        mb.paint(hexRGB(cols[k % 3]), M.leaf);
        mb.blob([top[0] + Math.cos(a) * d - (k === 4 ? 0.6 : 0), top[1] + (rr() - 0.5) * 0.2, Math.sin(a) * d], [0.85, 0.28, 0.85], rr() * 99, 1);
      }
    }
    mb.xf = prev;
  }
}
