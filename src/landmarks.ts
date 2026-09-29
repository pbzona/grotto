import { World, Prop, PropType, WATER_Y, N, levelY, propOpt, HULL_OPTS, GROTTO_OPTS, hullDims, grottoDims, landmarkSamples, isLandmark, fbm } from "./world";
import { MeshBuilder, V3, M, hexRGB, rng, lerp3, add } from "./mesh";
import type { Light } from "./houses";
import { PALETTES } from "./houses";
import { hull, barrel } from "./props";

/**
 * Landmarks (hull tavern, sea grotto, lighthouse) are big enough that they have to be sited, not dropped:
 * a solver searches around the cursor for a position and heading that suits the ground and clears
 * everything else, and the builders read the terrain so the result sits into it.
 */

const clampN = (v: number) => Math.min(N - 0.01, Math.max(0.01, v));
const H = (w: World, x: number, z: number) => w.height(clampN(x), clampN(z));

export interface Fit { x: number; z: number; rot: number; ok: boolean; why?: string }

/** Does this landmark (at its current x/z/rot) collide with houses, walkways or other props? */
export function landmarkClash(w: World, p: Prop): string | null {
  const pts = landmarkSamples(p);
  for (const [x, z] of pts) {
    if (x < 0.4 || z < 0.4 || x > N - 0.4 || z > N - 0.4) return "Too close to the edge";
    if (w.houseAt(x, z, 0.2)) return "A house is in the way";
  }
  for (const e of w.edges.values()) {
    const a = w.nodes.get(e.a), b = w.nodes.get(e.b); if (!a || !b) continue;
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-6;
    for (const [x, z] of pts) {
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
      if (Math.hypot(a.x + dx * t - x, a.z + dz * t - z) < e.width / 2 + 0.25) return "A walkway is in the way";
    }
  }
  for (const o of w.props.values()) {
    if (o.id === p.id) continue;
    if (isLandmark(o.type)) {
      const op = landmarkSamples(o);
      for (const [x, z] of pts) for (const [ox, oz] of op) if (Math.abs(x - ox) < 0.6 && Math.abs(z - oz) < 0.6) return "Too close to another landmark";
    } else if (o.type === "rowboat" || o.type === "sloop") {
      for (const [x, z] of pts) if (Math.hypot(o.x - x, o.z - z) < (o.type === "sloop" ? 1.4 : 0.8)) return "A boat is moored there";
    } else {
      for (const [x, z] of pts) if (Math.hypot(o.x - x, o.z - z) < 0.45) return "Something is in the way";
    }
  }
  return null;
}

/** Terrain score for a site; -Infinity when the ground can't take it. */
function siteScore(w: World, p: Prop): { s: number; why?: string } {
  const c = Math.cos(p.rot), sn = Math.sin(p.rot);
  const G = (lx: number, lz: number) => H(w, p.x + lx * c - lz * sn, p.z + lx * sn + lz * c);
  if (p.type === "grotto") {
    const { R, D } = grottoDims(p);
    // the mouth must open onto water and the vault must run back into a cliff
    let wet = 0, n = 0, back = 0, nb = 0, minBack = Infinity;
    for (let lx = -R - 1; lx <= R + 1 + 1e-6; lx += (R + 1) / 3) for (let lz = 1; lz <= 5.6; lz += 0.9) { n++; if (G(lx, lz) < WATER_Y - 0.3) wet++; }
    for (let lx = -R; lx <= R + 1e-6; lx += R / 2) for (let lz = -1.4; lz >= -D; lz -= 1.1) { const g = G(lx, lz); nb++; back += Math.min(g, WATER_Y + 5); minBack = Math.min(minBack, g); }
    back /= nb;
    if (wet / n < 0.85) return { s: -Infinity, why: "Needs open water in front of the mouth" };
    if (minBack < WATER_Y + 0.9 || back < WATER_Y + 2) return { s: -Infinity, why: "Needs a cliff to cut into" };
    return { s: back * 0.6 + (wet / n) * 3 };
  }
  if (p.type === "hull") {
    const { len, wid } = hullDims(p);
    const gs: number[] = [];
    for (let lz = -len * 0.45; lz <= len * 0.45 + 1e-6; lz += len * 0.15) for (const lx of [-wid * 0.4, 0, wid * 0.4]) gs.push(G(lx, lz));
    const lo = Math.min(...gs), hi = Math.max(...gs), mean = gs.reduce((a, b) => a + b, 0) / gs.length;
    if (mean < WATER_Y - 1.1) return { s: -Infinity, why: "Too deep — beach it on sand or shallows" };
    if (hi - lo > 1.6) return { s: -Infinity, why: "Too steep for a beached hull" };
    return { s: -(hi - lo) * 2 - Math.abs(mean - (WATER_Y + 0.15)) * 1.2 };
  }
  // lighthouse: prefers level, high ground
  const gs = [G(0, 0), G(1, 0), G(-1, 0), G(0, 1), G(0, -1)];
  const lo = Math.min(...gs), hi = Math.max(...gs);
  if (lo < WATER_Y - 0.6) return { s: -Infinity, why: "Needs land to stand on" };
  if (hi - lo > 1.3) return { s: -Infinity, why: "Too steep here" };
  return { s: lo * 0.3 - (hi - lo) * 2 };
}

/**
 * Search around (hx, hz) for the best site. `flip` turns the hull end-for-end.
 * Headings are free: the grotto faces out of its cliff, the hull lies along the shore.
 */
export function fitLandmark(w: World, type: PropType, hx: number, hz: number, seed: number, opts: Prop["opts"], flip: boolean, selfId = "ghost"): Fit {
  const probe: Prop = { id: selfId, type, x: hx, z: hz, rot: 0, seed, opts };
  let best: Fit | null = null, bestS = -Infinity, why = "Won't fit here";
  const rots = type === "lighthouse" ? [0] : Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2);
  const R = type === "lighthouse" ? 1.5 : 3;
  for (let dz = -R; dz <= R + 1e-6; dz += 0.5) for (let dx = -R; dx <= R + 1e-6; dx += 0.5) {
    const d = Math.hypot(dx, dz); if (d > R) continue;
    probe.x = hx + dx; probe.z = hz + dz;
    for (const rot of rots) {
      probe.rot = rot;
      const sc = siteScore(w, probe);
      if (sc.s === -Infinity) { if (d === 0 && rot === 0) why = sc.why ?? why; continue; }
      const s = sc.s - d * 0.35;
      if (s <= bestS) continue;
      const clash = landmarkClash(w, probe);
      if (clash) { if (d === 0) why = clash; continue; }
      bestS = s; best = { x: probe.x, z: probe.z, rot, ok: true };
    }
  }
  if (!best) return { x: hx, z: hz, rot: 0, ok: false, why };
  if (flip && type === "hull") best.rot += Math.PI;
  best.x = Math.round(best.x * 10) / 10; best.z = Math.round(best.z * 10) / 10;
  return best;
}

// ---------------- sea grotto ----------------
/** The cells a grotto lowers and the level each is capped at: a flooded channel under the vault, a lowered lip at the mouth. */
export function grottoCells(p: Prop): { i: number; j: number; cap: number; under: boolean }[] {
  const { R, D, T } = grottoDims(p);
  const c = Math.cos(p.rot), s = Math.sin(p.rot), out: { i: number; j: number; cap: number; under: boolean }[] = [];
  const lip = Math.round((R * 0.95 - 0.8 + T + 0.2 - levelY(0)) / 0.5);
  for (let j = Math.floor(p.z - D - 5); j <= Math.ceil(p.z + D + 5); j++) for (let i = Math.floor(p.x - D - 5); i <= Math.ceil(p.x + D + 5); i++) {
    if (i < 0 || j < 0 || i >= N || j >= N) continue;
    const dx = i + 0.5 - p.x, dz = j + 0.5 - p.z;
    const lx = dx * c + dz * s, lz = -dx * s + dz * c, ax = Math.abs(lx);
    if (lz > 5 || lz < -D - 0.6) continue;
    if (ax < R * 1.2 + Math.min(Math.max(0, lz), 2.5) * 0.4) out.push({ i, j, cap: 3, under: lz < -0.3 });
    else if (ax < R + T + 0.9 && lz > -0.9 && lz < 0.7) out.push({ i, j, cap: lip, under: false });
  }
  return out;
}

export function buildGrotto(mb: MeshBuilder, w: World, p: Prop, L: Light[]) {
  const r = rng(p.seed);
  const { R, D, T } = grottoDims(p);
  const arch = propOpt(p, "arch", GROTTO_OPTS.arch), dock = propOpt(p, "dock", GROTTO_OPTS.dock);
  const sx = arch === "wide" ? 1.3 : arch === "tall" ? 0.9 : 1.1, sy = arch === "wide" ? 0.72 : arch === "tall" ? 1.22 : 0.95;
  const NU = 28, NV = 12;
  const noise = (u: number, v: number, rad: number) => fbm(u * 4.2 + rad * 0.7 + p.seed * 13, v * 3.1 + rad * 0.3) - 0.5;
  const shell = (rad: number, u: number, v: number): V3 => {
    const th = Math.PI * u;
    const bulge = 1 + 0.12 * Math.sin(v * Math.PI) + noise(u, v, rad) * (rad > R + 0.5 ? 0.42 : 0.22);
    const rr = rad * bulge * (1 - 0.35 * v * v);
    const sv = Math.sin(th), pointy = arch === "tall" ? Math.pow(sv, 0.7) : sv;
    return [Math.cos(th) * rr * sx, pointy * rr * sy - 0.8, -D * v];
  };
  const prev = mb.xf!;
  mb.paint(hexRGB("#dba46b"), M.rock);
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const u0 = i / NU, u1 = (i + 1) / NU, v0 = j / NV, v1 = (j + 1) / NV;
    const inn = [shell(R, u0, v0), shell(R, u1, v0), shell(R, u1, v1), shell(R, u0, v1)];
    const outr = [shell(R + T, u0, v0), shell(R + T, u1, v0), shell(R + T, u1, v1), shell(R + T, u0, v1)];
    const cI = lerp3(inn[0], inn[2], 0.5), cO = lerp3(outr[0], outr[2], 0.5);
    mb.quad(inn, [-cI[0], -cI[1] - 0.8, 0]);
    mb.quad(outr, [cO[0], cO[1] + 0.8, 0]);
  }
  for (let i = 0; i < NU; i++) {
    const a = shell(R, i / NU, 0), b = shell(R, (i + 1) / NU, 0), c = shell(R + T, (i + 1) / NU, 0), d = shell(R + T, i / NU, 0);
    mb.quad([a, b, c, d], [0, 0, 1]);
    const e = shell(R, i / NU, 1), f = shell(R, (i + 1) / NU, 1);
    mb.tri([[0, -0.8, -D * 0.95], e, f], [0, 0, 1]);
    const g = shell(R + T, i / NU, 1), hh = shell(R + T, (i + 1) / NU, 1);
    mb.quad([e, f, hh, g], [0, 0, -1]);
  }
  // the cliff over the vault: rebuild the terrain surface the carve removed (same height function, original levels),
  // so above the cave the cliff reads as continuous ground rather than a trench
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  const vaultTop = R * sy - 0.8 + T + WATER_Y;
  if (p.carved?.length) {
    const orig = Object.create(World.prototype) as World;
    orig.heights = w.heights.slice();
    for (const [i, j, l] of p.carved) orig.heights[j * N + i] = l;
    const step = 0.25, X = R * sx + T + 1.6, Z0 = -D - 1.5;
    const nx = Math.ceil((2 * X) / step), nz = Math.ceil(-Z0 / step);
    const vx: number[][] = [], vo: number[][] = [], vc: number[][] = [];
    for (let k = 0; k <= nz; k++) { vx.push([]); vo.push([]); vc.push([]); for (let i = 0; i <= nx; i++) {
      const lx = -X + i * step, lz = Z0 + k * step, wx = clampN(p.x + lx * c - lz * s), wz = clampN(p.z + lx * s + lz * c);
      vo[k].push(orig.height(wx, wz)); vc[k].push(w.height(wx, wz));
    } }
    const on = (i: number, k: number) => {
      if (i < 0 || k < 0 || i >= nx || k >= nz) return false;
      let ok = true;
      for (const [a2, b2] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const o = vo[k + b2][i + a2], cu = vc[k + b2][i + a2]; if (o - cu < 0.04 || o < vaultTop - 0.1) ok = false; }
      return ok;
    };
    const P = (i: number, k: number, y: number): V3 => [-X + i * step, y - WATER_Y, Z0 + k * step];
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      if (!on(i, k)) continue;
      const q: V3[] = [P(i, k, vo[k][i]), P(i + 1, k, vo[k][i + 1]), P(i + 1, k + 1, vo[k + 1][i + 1]), P(i, k + 1, vo[k + 1][i])];
      const slope = Math.max(Math.abs(vo[k][i + 1] - vo[k][i]), Math.abs(vo[k + 1][i] - vo[k][i])) / step;
      if (slope > 0.8) mb.paint(hexRGB("#dba46b"), M.rock); else mb.paint(hexRGB(slope > 0.45 ? "#9a9a5e" : "#8a955e"), M.leaf);
      mb.quad(q, [0, 1, 0]);
      // skirts where the cap meets the open channel or the mouth
      const edges: [number, number, number, number, V3][] = [[i, k, i + 1, k, [0, 0, -1]], [i + 1, k + 1, i, k + 1, [0, 0, 1]], [i, k + 1, i, k, [-1, 0, 0]], [i + 1, k, i + 1, k + 1, [1, 0, 0]]];
      const nb = [on(i, k - 1), on(i, k + 1), on(i - 1, k), on(i + 1, k)];
      mb.paint(hexRGB("#dba46b"), M.rock);
      edges.forEach(([i0, k0, i1, k1, n], e) => {
        if (nb[e]) return;
        const y0 = vo[k0][i0], y1 = vo[k1][i1], b0 = Math.max(vc[k0][i0], vaultTop - 1.2), b1 = Math.max(vc[k1][i1], vaultTop - 1.2);
        if (y0 - b0 < 0.02 && y1 - b1 < 0.02) return;
        mb.quad([P(i0, k0, y0), P(i1, k1, y1), P(i1, k1, b1), P(i0, k0, b0)], n);
      });
    }
    // a few tufts on the cap
    for (let t = 0; t < 6; t++) { const i = Math.floor(r() * nx), k = Math.floor(r() * nz); if (!on(i, k)) continue; mb.paint(hexRGB(r() < 0.5 ? "#7b8a4c" : "#8e9656"), M.leaf); mb.blob(P(i, k, vo[k][i] + 0.1), [0.35, 0.22, 0.35], r() * 99, 0); }
  }
  mb.paint(hexRGB("#dba46b"), M.rock);
  // rubble at the feet and a brow of rock over the lip
  for (let i = 0; i < 6; i++) { const sg = i % 2 ? 1 : -1; mb.blob([sg * (R * sx + 0.3 + r() * 0.8), -0.6, -r() * D * 0.8 + 0.3], [0.6, 0.5, 0.6], r() * 99, 1); }
  for (let i = 0; i < 5; i++) mb.blob([(i / 4 - 0.5) * R * sx * 1.6, vaultTop - WATER_Y - 0.35, -0.2 - r() * 0.4], [0.7, 0.45, 0.6], r() * 99, 1);
  // hanging greenery and a few stalactites
  mb.paint(hexRGB("#6f8a45"), M.leaf);
  const vines = 3 + Math.floor(r() * 5);
  for (let i = 0; i < vines; i++) {
    const u = 0.15 + r() * 0.7; const q = shell(R + T * 0.5, u, 0); const len = Math.min(0.3 + r() * 0.8, q[1] - 0.7);
    if (len < 0.2) continue;
    const pts: V3[] = []; for (let k = 0; k <= 5; k++) pts.push([q[0] + Math.sin(k * 1.7 + i) * 0.04, q[1] - (k / 5) * len, 0.22]);
    mb.paint(hexRGB("#5d7a3c"), M.leaf); mb.tube(pts, 0.02, 3);
    mb.paint(hexRGB(r() < 0.3 ? "#c9577a" : "#6f8a45"), M.leaf);
    for (let k = 0; k < 5; k++) { const t = k / 4; mb.blob([pts[0][0] + (r() - 0.5) * 0.12, q[1] - t * len, 0.24], [0.08, 0.07, 0.05], r() * 99, 0); }
  }
  mb.paint(hexRGB("#c99561"), M.rock);
  for (let i = 0; i < 8; i++) { const u = 0.2 + r() * 0.6, v = 0.2 + r() * 0.7; const q = shell(R, u, v); mb.cyl(q[0] * 0.95, q[2], q[1] - 0.45 - r() * 0.3, q[1] + 0.05, 0.015, 0.1, 5); }
  // the hidden dock
  const deckY = 0.75;
  const sides = dock === "both" ? [-1, 1] : dock === "left" ? [-1] : [1];
  for (const sd of sides) {
    const xa = sd * R * sx * 0.92, xb = sd * R * sx * 0.25;
    const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
    mb.paint(hexRGB("#9c7b58"), M.plank);
    const nb = Math.floor((D * 0.85 + 0.4) / 0.24);
    for (let k = 0; k < nb; k++) { const z = 0.4 - k * 0.24; mb.box([x0, deckY - 0.06, z - 0.1], [x1, deckY, z + 0.1]); }
    mb.paint(hexRGB("#4c3b2e"), M.plank);
    for (let k = 0; k < 4; k++) for (const x of [x0 + 0.1, x1 - 0.1]) mb.cyl(x, 0.3 - k * D * 0.28, -1.5, deckY - 0.05, 0.07, 0.07, 6);
    const zb = -D * 0.72;
    if (r() < 0.7) { mb.paint(hexRGB("#9a7650"), M.plank); mb.box([x0 + 0.1, deckY, zb], [x0 + 0.5, deckY + 0.45, zb + 0.4]); mb.box([x0 + 0.15, deckY + 0.45, zb + 0.05], [x0 + 0.45, deckY + 0.75, zb + 0.35]); }
    barrel(mb, (x0 + x1) / 2, -D * 0.55, deckY, r);
    if (r() < 0.6) barrel(mb, (x0 + x1) / 2 + 0.3, -D * 0.45, deckY, r);
    if (r() < 0.5) { mb.paint(hexRGB("#8a5a2a"), M.plank); mb.box([x0 + 0.2, deckY, -D * 0.3], [x0 + 0.62, deckY + 0.28, -D * 0.3 + 0.3]); mb.paint(hexRGB("#ffd070"), M.lamp); mb.box([x0 + 0.24, deckY + 0.28, -D * 0.3 + 0.04], [x0 + 0.58, deckY + 0.31, -D * 0.3 + 0.26]); L.push({ x: x0 + 0.4, y: deckY + 0.4, z: -D * 0.3, r: 1.4, i: 0.4 }); }
    for (const z of [0.1, -D * 0.4, -D * 0.75]) {
      const xl = sd * R * sx * 0.98;
      mb.paint(hexRGB("#3b332c"), M.metal); mb.beam([xl, 1.9, z], [xl - sd * 0.3, 1.9, z], [0, 0, 1], 0.02, 0.02);
      mb.paint(hexRGB("#ffd08a"), M.lamp); mb.box([xl - sd * 0.36 - 0.06, 1.52, z - 0.07], [xl - sd * 0.36 + 0.06, 1.75, z + 0.07]);
      L.push({ x: xl - sd * 0.36, y: 1.6, z, r: 3.1, i: 0.85 });
    }
    // stair cut into the rock at the back of this dock
    mb.paint(hexRGB("#c99561"), M.rock);
    for (let k = 0; k < 7; k++) { const x = sd < 0 ? x1 - 0.1 + k * 0.22 : x0 + 0.1 - k * 0.22; mb.box([Math.min(x, x + 0.28 * sd), deckY + k * 0.25 - 0.25, -D * 0.82], [Math.max(x, x + 0.28 * sd), deckY + k * 0.25, -D * 0.82 + 0.8]); }
  }
  // a skiff tied up inside when there's room
  if (dock !== "both" && r() < 0.75) {
    const bx = -sides[0] * R * sx * 0.35;
    const sm = mb.xf!;
    mb.xf = (q: V3) => sm([q[0] + bx, q[1] + 0.2, q[2] - D * 0.45]);
    hull(mb, 1.8, 0.72, 0.28, hexRGB(["#3f8783", "#c0643f", "#e9dcbc"][Math.floor(r() * 3)]), hexRGB("#8a6a48"), hexRGB("#efe4cc"));
    mb.xf = sm;
  }
  mb.xf = prev;
  void add;
}

// ---------------- hull tavern ----------------
/** Ground-fitted pose: pitch follows the beach, roll cants toward the low side, the keel beds into the sand. */
export function hullPose(w: World, p: Prop) {
  const { len, wid, dep } = hullDims(p);
  const r = rng(p.seed + 0.77);
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  const G = (lx: number, lz: number) => H(w, p.x + lx * c - lz * s, p.z + lx * s + lz * c);
  const gB = G(0, len * 0.4), gS = G(0, -len * 0.4), gP = G(-wid * 0.45, 0), gR = G(wid * 0.45, 0);
  const gs: number[] = []; for (let k = -2; k <= 2; k++) for (const lx of [-wid * 0.3, 0, wid * 0.3]) gs.push(G(lx, k * len * 0.18));
  const mean = gs.reduce((a, b) => a + b, 0) / gs.length;
  const pitch = Math.max(-0.2, Math.min(0.2, Math.atan2(gB - gS, len * 0.8))) + (r() - 0.5) * 0.05;
  const side = Math.atan2(gR - gP, wid * 0.9);
  const cant = (r() < 0.5 ? -1 : 1) * (0.06 + r() * 0.1);
  const roll = Math.max(-0.28, Math.min(0.28, side * 0.8 + cant));
  const keel = Math.max(mean - dep * 0.3, WATER_Y - dep * 0.6);
  return { pitch, roll, y0: keel + dep, len, wid, dep };
}

export function buildHullTavern(mb: MeshBuilder, w: World, p: Prop, L: Light[]) {
  const r = rng(p.seed);
  const pose = hullPose(w, p);
  const { len, wid, dep, pitch, roll, y0 } = pose;
  const cabin = propOpt(p, "cabin", HULL_OPTS.cabin), roof = propOpt(p, "roof", HULL_OPTS.roof);
  const masts = propOpt(p, "masts", HULL_OPTS.masts), annex = propOpt(p, "annex", HULL_OPTS.annex);
  const hullCols = ["#3f5f63", "#2e4a52", "#5a3b2e", "#4d5a3a", "#6b4a33"];
  const hullC = hexRGB(hullCols[Math.floor(r() * hullCols.length)]), stripeC = hexRGB(["#b85a3a", "#d9a84e", "#efe4cc", "#3f8783"][Math.floor(r() * 4)]);
  const pal = PALETTES[Math.floor(r() * PALETTES.length)];
  const wallC = hexRGB(pal.wall), trimC = hexRGB(pal.trim), roofC = hexRGB(pal.roof);
  const c = Math.cos(p.rot), s = Math.sin(p.rot), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  // local (hull frame) → world
  const toWorld = (q: V3): V3 => {
    let [x, y, z] = q;
    [x, y] = [x * cr - y * sr, x * sr + y * cr];     // roll about the keel
    [y, z] = [y * cp + z * sp, -y * sp + z * cp];     // pitch bow up/down
    return [p.x + x * c - z * s, y0 + y, p.z + x * s + z * c];
  };
  const flat = (q: V3): V3 => [p.x + q[0] * c - q[2] * s, q[1], p.z + q[0] * s + q[2] * c]; // yaw only, absolute y
  const G = (lx: number, lz: number) => H(w, p.x + lx * c - lz * s, p.z + lx * s + lz * c);
  const Lp = (q: V3, rr: number, i: number, abs = false) => { const t = abs ? flat(q) : toWorld(q); L.push({ x: t[0], y: t[1], z: t[2], r: rr, i }); };
  mb.xf = toWorld;
  hull(mb, len, wid, dep, hullC, hexRGB("#6b4a33"), stripeC);
  mb.paint(hexRGB("#9c7b58"), M.plank);
  mb.box([-wid * 0.46, 0.05, -len * 0.42], [wid * 0.46, 0.13, len * 0.38]);
  // portholes along the hull (the side toward the door gets them all)
  const nPort = Math.max(3, Math.round(len / 2));
  for (let i = 0; i < nPort; i++) {
    const z = -len * 0.33 + (i / (nPort - 1)) * len * 0.62;
    mb.paint([0.2, 0.3, 0.33], M.glass); mb.box([-wid * 0.5 - 0.02, -0.55, z - 0.18], [-wid * 0.5 + 0.2, -0.22, z + 0.18]);
    Lp([-wid * 0.5 - 0.4, -0.4, z], 1.8, 0.3);
  }
  // cabin: built level (only the hull follows the ground), anchored where the deck meets the cabin's middle
  const cw = wid * 0.37;
  const [cz0, cz1, ch] = cabin === "stern" ? [-len * 0.42, -len * 0.04, 1.8] : cabin === "tall" ? [-len * 0.28, len * 0.22, 2.35] : [-len * 0.32, len * 0.3, 1.25];
  const base = 0.13, ry = base + ch, czm = (cz0 + cz1) / 2;
  let deckTop = -Infinity;
  for (const [x, z] of [[-cw, cz0], [cw, cz0], [cw, cz1], [-cw, cz1]]) deckTop = Math.max(deckTop, toWorld([x, base, z])[1]);
  const lvlY = deckTop - base; // the cabin floor sits on the deck's highest corner, walls run down into the hull at the low side
  const level = (q: V3): V3 => { const hx = q[0], hz = q[2]; const b = toWorld([0, 0, 0]); return [b[0] + hx * c - hz * s, lvlY + q[1], b[2] + hx * s + hz * c]; };
  const Lv = (q: V3, rr: number, i: number) => { const t = level(q); L.push({ x: t[0], y: t[1], z: t[2], r: rr, i }); };
  mb.xf = level;
  mb.paint(wallC, r() < 0.5 ? M.plank : M.plaster); mb.box([-cw, base - 0.9, cz0], [cw, ry, cz1], "-y");
  mb.paint(hexRGB("#9c7b58"), M.plank); mb.box([-cw - 0.25, base - 0.06, cz0 - 0.25], [cw + 0.25, base, cz1 + 0.25]); // a level floor apron round the cabin
  if (cabin === "tall") { mb.paint(hexRGB("#7a5438"), M.plank); mb.box([-cw - 0.05, base + 1.1, cz0 - 0.05], [cw + 0.05, base + 1.2, cz1 + 0.05]); }
  // windows on both sides, both storeys
  const rows = cabin === "tall" ? [0.45, 1.55] : [0.42];
  for (const wy of rows) for (let k = 0; k < 3; k++) {
    const z = cz0 + (k + 0.5) * (cz1 - cz0) / 3;
    mb.paint([0.2, 0.3, 0.33], M.glass);
    mb.box([-cw - 0.03, base + wy, z - 0.22], [-cw + 0.02, base + wy + 0.42, z + 0.22]); mb.box([cw - 0.02, base + wy, z - 0.22], [cw + 0.03, base + wy + 0.42, z + 0.22]);
    mb.paint(trimC, M.plank);
    mb.box([-cw - 0.06, base + wy - 0.05, z - 0.27], [-cw - 0.02, base + wy, z + 0.27]); mb.box([cw + 0.02, base + wy - 0.05, z - 0.27], [cw + 0.06, base + wy, z + 0.27]);
    Lv([-cw - 0.3, base + wy + 0.2, z], 1.4, 0.22);
  }
  // roof
  const ov = 0.28;
  if (roof === "gable" || roof === "hip") {
    const rh = cw * 0.85, ridge0 = roof === "hip" ? cz0 + cw * 0.8 : cz0 - ov, ridge1 = roof === "hip" ? cz1 - cw * 0.8 : cz1 + ov;
    mb.paint(roofC, M.tile);
    for (const sg of [-1, 1]) {
      mb.quad([[sg * (cw + ov), ry - 0.08, cz0 - ov], [sg * (cw + ov), ry - 0.08, cz1 + ov], [0, ry + rh, ridge1], [0, ry + rh, ridge0]], [sg, 1, 0]);
      mb.quad([[sg * (cw + ov), ry - 0.14, cz0 - ov], [sg * (cw + ov), ry - 0.14, cz1 + ov], [0, ry + rh - 0.06, ridge1], [0, ry + rh - 0.06, ridge0]], [0, -1, 0]);
    }
    if (roof === "hip") {
      for (const [ze, zr, sg] of [[cz0 - ov, ridge0, -1], [cz1 + ov, ridge1, 1]] as const)
        mb.tri([[-cw - ov, ry - 0.08, ze], [cw + ov, ry - 0.08, ze], [0, ry + rh, zr]], [0, 1, sg]);
    } else {
      mb.paint(wallC, M.plank);
      for (const zz of [cz0, cz1]) mb.tri([[-cw, ry, zz], [cw, ry, zz], [0, ry + rh - 0.1, zz]], [0, 0, zz - czm]);
    }
    // a patch or two of mismatched tiles
    mb.paint(hexRGB(pal.roof, 0.78), M.tile);
    for (let k = 0; k < 1 + Math.floor(r() * 2); k++) { const z = cz0 + r() * (cz1 - cz0 - 0.8); mb.box([cw * 0.15, ry + rh * 0.4, z], [cw * 0.75, ry + rh * 0.5, z + 0.6]); }
    // stove pipe
    mb.paint(hexRGB("#3b332c"), M.metal); mb.cyl(-cw * 0.4, cz0 + (cz1 - cz0) * 0.7, ry + rh * 0.4, ry + rh + 0.5, 0.07, 0.07, 6);
  } else {
    // flat roof terrace with a striped canvas awning and a rail
    mb.paint(hexRGB("#9c7b58"), M.plank); mb.box([-cw - 0.12, ry, cz0 - 0.12], [cw + 0.12, ry + 0.1, cz1 + 0.12]);
    mb.paint(hexRGB("#7a5438"), M.plank);
    for (const [x, z] of [[-cw, cz0], [cw, cz0], [cw, cz1], [-cw, cz1]]) mb.cyl(x, z, ry + 0.1, ry + 1.05, 0.04, 0.04, 5);
    mb.beam([-cw, ry + 0.5, cz0], [-cw, ry + 0.5, cz1], [1, 0, 0], 0.025, 0.025); mb.beam([cw, ry + 0.5, cz0], [cw, ry + 0.5, cz1], [1, 0, 0], 0.025, 0.025);
    const nS = 6;
    for (let k = 0; k < nS; k++) {
      const z0 = cz0 + (k / nS) * (cz1 - cz0), z1 = cz0 + ((k + 1) / nS) * (cz1 - cz0);
      mb.paint(k % 2 ? hexRGB("#efe4cc") : trimC, M.cloth);
      mb.quad([[-cw - 0.1, ry + 1.05, z0], [cw + 0.1, ry + 0.95, z0], [cw + 0.1, ry + 0.95, z1], [-cw - 0.1, ry + 1.05, z1]], [0, 1, 0]);
      mb.quad([[-cw - 0.1, ry + 1.05, z0], [cw + 0.1, ry + 0.95, z0], [cw + 0.1, ry + 0.95, z1], [-cw - 0.1, ry + 1.05, z1]], [0, -1, 0]);
    }
    barrel(mb, cw * 0.3, (cz0 + cz1) / 2, ry + 0.1, r);
    mb.paint(hexRGB("#ffcf80"), M.lamp); mb.box([-0.06, ry + 0.75, czm - 0.06], [0.06, ry + 0.92, czm + 0.06]); Lv([0, ry + 0.8, czm], 2.2, 0.5);
  }
  // door on the port side, at whichever deck end is free
  const dz = cabin === "stern" ? cz1 - 0.8 : czm + 0.3;
  mb.paint(trimC, M.plank); mb.box([-cw - 0.04, base, dz - 0.3], [-cw + 0.01, base + 0.95, dz + 0.3]);
  mb.paint(hexRGB("#2e2a26"), M.metal); mb.box([-cw - 0.12, base + 1.02, dz - 0.35], [-cw - 0.04, base + 1.05, dz - 0.25]);
  mb.paint(hexRGB("#ffd08a"), M.lamp); mb.box([-cw - 0.14, base + 0.86, dz - 0.36], [-cw - 0.04, base + 1.02, dz - 0.24]);
  Lv([-cw - 0.4, base + 0.9, dz], 2.4, 0.7);
  // forward deck life for a stern cabin: barrel tables and a parasol
  if (cabin === "stern") {
    for (let k = 0; k < 2; k++) { const z = len * 0.08 + k * len * 0.14, x = (k ? 0.35 : -0.35); barrel(mb, x, z, base, r); }
    mb.paint(hexRGB("#7a5438"), M.plank); mb.cyl(0, len * 0.15, base, base + 1.5, 0.03, 0.03, 5);
    mb.paint(trimC, M.cloth); mb.cyl(0, len * 0.15, base + 1.3, base + 1.6, 0.9, 0.05, 8);
  }
  // masts
  const mastAt = masts === 2 ? [len * 0.3, -len * 0.05] : masts === 1 ? [len * 0.3] : [];
  const tips: V3[] = [];
  mb.paint(hexRGB("#6b4a33"), M.plank);
  if (masts === 0) mb.cyl(0.4, len * 0.3, base, base + 0.9 + r() * 0.4, 0.1, 0.09, 7); // broken stump
  for (const [k, mz] of mastAt.entries()) {
    const hgt = (k ? 2.6 : 3.4) + r() * 0.4, x = cabin !== "stern" && Math.abs(mz - czm) < (cz1 - cz0) / 2 ? cw + 0.2 : 0.3;
    mb.paint(hexRGB("#6b4a33"), M.plank); mb.cyl(x, mz, base, base + hgt, 0.1, 0.07, 7);
    mb.paint(hexRGB("#e9dcbc"), M.cloth);
    const top = base + hgt - 0.05;
    mb.tri([[x, top, mz], [x, top - 0.4, mz], [x, top - 0.2, mz + 1.0]], [1, 0, 0]); mb.tri([[x, top, mz], [x, top - 0.4, mz], [x, top - 0.2, mz + 1.0]], [-1, 0, 0]);
    tips.push([x, top - 0.2, mz]);
  }
  // strings of lanterns from the masts (or between them)
  const strands: [V3, V3][] = [];
  if (tips.length === 2) strands.push([tips[0], tips[1]]);
  for (const t of tips) strands.push([t, [-wid * 0.45, 0.4, len * 0.45]], [t, [-wid * 0.45, 0.4, -len * 0.25]]);
  mb.xf = null;
  for (const [k, [a, b]] of strands.slice(0, 3).entries()) {
    const A = level(a), B = k === 0 && tips.length === 2 ? level(b) : toWorld(b);
    const pts: V3[] = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; const q = lerp3(A, B, t); pts.push([q[0], q[1] - Math.sin(Math.PI * t) * 0.4, q[2]]); }
    mb.paint(hexRGB("#3b332c"), M.cloth); mb.tube(pts, 0.01, 3);
    for (let i = 2; i < 10; i += 2) { mb.paint(hexRGB(i % 4 ? "#ffcf80" : "#ff9f6a"), M.lamp); mb.blob(add(pts[i], [0, -0.07, 0]), [0.05, 0.07, 0.05], i, 0); L.push({ x: pts[i][0], y: pts[i][1], z: pts[i][2], r: 1.6, i: 0.28 }); }
  }
  // ---- things on the ground: yaw only, absolute heights ----
  mb.xf = flat;
  const doorW = level([-cw - 0.04, base, dz]);
  const footLx = -wid * 0.5 - 1.2;
  const gFoot = G(footLx, dz);
  // steps (or a gangplank) from the ground to the door
  const rise = doorW[1] - gFoot;
  if (rise > 0.15) {
    const n = Math.max(2, Math.ceil(rise / 0.22));
    mb.paint(hexRGB("#9c7b58"), M.plank);
    for (let i = 0; i < n; i++) {
      const x0 = footLx + (i / n) * (-cw - footLx - 0.05), x1 = footLx + ((i + 1) / n) * (-cw - footLx - 0.05);
      mb.box([x0, gFoot - 0.3, dz - 0.35], [x1, gFoot + ((i + 1) / n) * rise, dz + 0.35]);
    }
  }
  // sign on a post
  const sgx = footLx - 0.3, sgz = dz + 1.1, gs = G(sgx, sgz);
  mb.paint(hexRGB("#6b4a33"), M.plank); mb.cyl(sgx, sgz, gs - 0.2, gs + 1.6, 0.04, 0.04, 6);
  mb.paint(hexRGB(["#e6a676", "#86b3a4", "#d9a84e"][Math.floor(r() * 3)]), M.plank); mb.box([sgx - 0.05, gs + 1.1, sgz - 0.4], [sgx + 0.03, gs + 1.5, sgz + 0.4]);
  Lp([footLx, gFoot + 1, dz], 3, 0.9, true);
  // annex beside the hull on the door side
  if (annex !== "none") {
    const ax0 = -wid / 2 - 2.3, ax1 = -wid / 2 - 0.15, az0 = -1.1, az1 = 1.7;
    const gMax = Math.max(G(ax0, az0), G(ax1, az0), G(ax0, az1), G(ax1, az1), WATER_Y);
    const dy = gMax + 0.35;
    mb.paint(hexRGB("#4c3b2e"), M.plank);
    for (const [x, z] of [[ax0 + 0.1, az0 + 0.1], [ax1 - 0.1, az0 + 0.1], [ax0 + 0.1, az1 - 0.1], [ax1 - 0.1, az1 - 0.1]]) mb.cyl(x, z, G(x, z) - 0.3, dy, 0.07, 0.07, 6);
    mb.paint(hexRGB("#a58461"), M.plank);
    for (let k = 0; k < Math.floor((az1 - az0) / 0.22); k++) { const z = az0 + k * 0.22 + 0.11; mb.box([ax0, dy - 0.05, z - 0.1], [ax1, dy, z + 0.1]); }
    if (annex === "deck") {
      for (let k = 0; k < 2; k++) { const x = ax0 + 0.6 + k * 1.0, z = az0 + 0.9 + k * 0.6; barrel(mb, x, z, dy, r); }
      mb.paint(hexRGB("#7a5438"), M.plank); mb.cyl(ax0 + 1.1, az0 + 1.2, dy, dy + 1.6, 0.03, 0.03, 5);
      mb.paint(trimC, M.cloth); mb.cyl(ax0 + 1.1, az0 + 1.2, dy + 1.35, dy + 1.7, 1.0, 0.05, 8);
      mb.paint(hexRGB("#6b4a33"), M.cloth);
      for (const x of [ax0 + 0.05, ax1 - 0.05]) { const pts: V3[] = []; for (let i = 0; i <= 6; i++) pts.push([x, dy + 0.55 - Math.sin(Math.PI * i / 6) * 0.06, az0 + (i / 6) * (az1 - az0)]); mb.tube(pts, 0.02, 4); }
    } else {
      // a little lean-to shack against the hull
      const sh = 1.3;
      mb.paint(wallC, M.plank); mb.box([ax0 + 0.2, dy, az0 + 0.2], [ax1, dy + sh, az1 - 0.3], "-y");
      mb.paint(roofC, M.tile);
      mb.quad([[ax0, dy + sh - 0.05, az0], [ax0, dy + sh - 0.05, az1], [ax1 + 0.1, dy + sh + 0.6, az1], [ax1 + 0.1, dy + sh + 0.6, az0]], [-1, 1, 0]);
      mb.quad([[ax0, dy + sh - 0.1, az0], [ax0, dy + sh - 0.1, az1], [ax1 + 0.1, dy + sh + 0.55, az1], [ax1 + 0.1, dy + sh + 0.55, az0]], [0, -1, 0]);
      mb.paint(wallC, M.plank);
      for (const z of [az0 + 0.2, az1 - 0.3]) mb.tri([[ax0 + 0.2, dy + sh, z], [ax1, dy + sh, z], [ax1, dy + sh + 0.55, z]], [0, 0, z - (az0 + az1) / 2]);
      mb.paint([0.2, 0.3, 0.33], M.glass); mb.box([ax0 + 0.17, dy + 0.5, az0 + 0.7], [ax0 + 0.22, dy + 0.9, az0 + 1.2]);
      Lp([ax0 - 0.2, dy + 0.7, az0 + 0.95], 1.6, 0.35, true);
    }
  }
  // bed the keel into the beach: a sand berm around the waterline, a few rocks and tufts
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const lx = Math.cos(a) * wid * 0.56, lz = Math.sin(a) * len * 0.5;
    const g = G(lx, lz);
    if (g < WATER_Y - 0.35) continue;
    mb.paint(hexRGB(g < WATER_Y + 0.15 ? "#c7a878" : "#dcc394"), M.plain);
    mb.blob([lx, g - 0.05, lz], [0.75, 0.22, 0.75], r() * 99, 0);
    if (r() < 0.25) { mb.paint(hexRGB("#d9a36c"), M.rock); mb.blob([lx * 1.15, g + 0.05, lz * 1.08], [0.3, 0.2, 0.26], r() * 99, 0); }
    else if (r() < 0.25 && g > WATER_Y + 0.3) { mb.paint(hexRGB("#8e9656"), M.leaf); mb.blob([lx * 1.12, g + 0.1, lz * 1.06], [0.25, 0.18, 0.25], r() * 99, 0); }
  }
  // props by the door
  barrel(mb, footLx - 0.2, dz - 0.9, G(footLx - 0.2, dz - 0.9), r);
  if (r() < 0.6) { mb.paint(hexRGB("#9a7650"), M.plank); const x = footLx + 0.1, z = dz - 1.6, g = G(x, z); mb.box([x - 0.25, g, z - 0.25], [x + 0.25, g + 0.45, z + 0.25]); }
}

export function buildLighthouseBase(mb: MeshBuilder, w: World, p: Prop, y: number) {
  // a stone plinth down to the lowest ground under the tower, so it never floats on a slope
  let lo = y;
  for (let k = 0; k < 12; k++) lo = Math.min(lo, H(w, p.x + Math.cos(k * 0.52) * 1.15, p.z + Math.sin(k * 0.52) * 1.15));
  if (lo < y - 0.05) { mb.paint(hexRGB("#b9a78b"), M.stone); mb.cyl(0, 0, lo - y - 0.4, 0.05, 1.25, 1.18, 14); }
}
