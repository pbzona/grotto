import { World, House, Volume, FLOOR_H, PLINTH, DECK_Y, WATER_Y, N, WalkNode, fbm } from "./world";
import { MeshBuilder, V3, M, hexRGB, rng, hsh, add, scl, lerp3, sub, norm, cross } from "./mesh";
import type { Home } from "./villagers";

/**
 * Parametric houses. A house is a few rectangular volumes plus parameters; everything visible —
 * stilts or plinth, walls, bays, windows, shutters, doors, roofs, chimneys — is regenerated from that
 * description. Houses over water or on slopes stand on tarred stilts at deck height, so the walkway
 * network meets their floors flush; a walkway ending at a wall opens a door there.
 */

export interface Palette { name: string; wall: string; trim: string; roof: string }
export const PALETTES: Palette[] = [
  { name: "Apricot", wall: "#e6a676", trim: "#3f8783", roof: "#c0643f" },
  { name: "Bone", wall: "#eee0c0", trim: "#a24a31", roof: "#b85a3a" },
  { name: "Sage", wall: "#a7b38c", trim: "#c8923a", roof: "#b0603e" },
  { name: "Rust", wall: "#c06c47", trim: "#e9dcbc", roof: "#8f6f55" },
  { name: "Rose", wall: "#dc9c86", trim: "#3f6f8f", roof: "#c46a45" },
  { name: "Ochre", wall: "#d9a84e", trim: "#2e6a6c", roof: "#a8553a" },
  { name: "Seaglass", wall: "#86b3a4", trim: "#f0e4c6", roof: "#b8603f" },
  { name: "Lime", wall: "#f1ead8", trim: "#3f8783", roof: "#c96b43" },
];
const WOOD = "#7a5438", TAR = "#4c3b2e", STONE = "#b9a78b";

export interface Light { x: number; y: number; z: number; r: number; i: number }
export interface Anchor { x: number; y: number; z: number; house: string }
/** One outside wall of a volume: where neighbours can string things across a gap. */
export interface Face { house: string; a: [number, number]; b: [number, number]; n: [number, number]; base: number; floors: number }
export interface HouseBuild { mb: MeshBuilder; lights: Light[]; anchors: Anchor[]; foam: { x: number; z: number; r: number }[]; faces?: Face[] }

export interface Bay { vi: number; side: number; floor: number; a: [number, number]; b: [number, number]; n: [number, number]; key: string; kind: "window" | "wall" | "door"; y0: number }
export interface Layout { base: number; gmin: number; gmax: number; over: boolean; stilts: boolean; plinth: boolean; rock: boolean; bays: Bay[]; lean: [number, number]; top: number; lived: boolean }

export const SIDES: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
export function sideLine(v: Volume, s: number): { a: [number, number]; b: [number, number]; n: [number, number] } {
  switch (s) {
    case 0: return { a: [v.x0, v.z1], b: [v.x1, v.z1], n: [0, 1] };
    case 1: return { a: [v.x1, v.z1], b: [v.x1, v.z0], n: [1, 0] };
    case 2: return { a: [v.x1, v.z0], b: [v.x0, v.z0], n: [0, -1] };
    default: return { a: [v.x0, v.z0], b: [v.x0, v.z1], n: [-1, 0] };
  }
}
const inside = (v: Volume, x: number, z: number) => x > v.x0 + 1e-3 && x < v.x1 - 1e-3 && z > v.z0 + 1e-3 && z < v.z1 - 1e-3;
const vkind = (v: Volume) => v.kind ?? "room";

export function houseGround(world: World, h: House) {
  let gmin = Infinity, gmax = -Infinity, over = false;
  for (const v of h.volumes) for (let z = v.z0 + 0.1; z <= v.z1 - 0.1 + 1e-6; z += Math.max(0.3, (v.z1 - v.z0 - 0.2) / Math.ceil((v.z1 - v.z0) / 0.5)))
    for (let x = v.x0 + 0.1; x <= v.x1 - 0.1 + 1e-6; x += Math.max(0.3, (v.x1 - v.x0 - 0.2) / Math.ceil((v.x1 - v.x0) / 0.5))) {
      const g = world.height(Math.min(N, Math.max(0, x)), Math.min(N, Math.max(0, z)));
      gmin = Math.min(gmin, g); gmax = Math.max(gmax, g);
      if (g < WATER_Y + 0.05) over = true;
    }
  return { gmin, gmax, over };
}

/** Doors forced by walkways ending against a wall: returns `vi:side:floor` → the point along the wall. */
export function walkDoors(world: World, h: House, base: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of world.nodes.values()) {
    if (!world.edgesOf(n.id).length) continue;
    const hit = nodeWall(h, n, base);
    if (hit) out.set(`${hit.vi}:${hit.side}:${hit.floor}`, hit.t);
  }
  return out;
}
/** How far out from a wall a walkway's post may stand and still open a door there (the deck runs on to the wall). */
export const DOOR_REACH = 0.65;
/** How far inside a wall a post may stand and still count as at it. */
const DOOR_INSET = 0.15;
/** Whether (x,z) is within door reach of any of the house's walls (a cheap footprint test, no storey check). */
export const nearWalls = (h: House, x: number, z: number, reach = DOOR_REACH) =>
  h.volumes.some(v => x > v.x0 - reach && x < v.x1 + reach && z > v.z0 - reach && z < v.z1 + reach);
/** The house wall a walkway post opens a door in, if any: the house, its floor height and the wall hit. */
export function doorOf(world: World, n: WalkNode) {
  for (const h of world.houses.values()) {
    if (!nearWalls(h, n.x, n.z)) continue;
    const base = houseLayout(world, h).base;
    const hit = nodeWall(h, n, base);
    if (hit) return { house: h, base, hit, line: sideLine(h.volumes[hit.vi], hit.side) };
  }
  return null;
}
export function nodeWall(h: House, n: WalkNode, base: number) {
  let best: { vi: number; side: number; floor: number; t: number; d: number } | null = null;
  h.volumes.forEach((v, vi) => {
    for (let s = 0; s < 4; s++) {
      const L = sideLine(v, s);
      const dx = n.x - L.a[0], dz = n.z - L.a[1];
      const out = dx * L.n[0] + dz * L.n[1];
      if (out < -DOOR_INSET || out > DOOR_REACH) continue;
      const tx = L.b[0] - L.a[0], tz = L.b[1] - L.a[1], len = Math.hypot(tx, tz);
      const t = (dx * tx + dz * tz) / len;
      if (t < 0.25 || t > len - 0.25) continue;
      const f = Math.round((n.y - base) / FLOOR_H);
      if (f < 0 || f >= v.floors || Math.abs(n.y - (base + f * FLOOR_H)) > 0.5) continue;
      // not if that stretch of wall is inside another volume
      const px = L.a[0] + tx / len * t + L.n[0] * 0.05, pz = L.a[1] + tz / len * t + L.n[1] * 0.05;
      if (h.volumes.some((o, oi) => oi !== vi && o.floors > f && inside(o, px, pz))) continue;
      if (!best || out < best.d) best = { vi, side: s, floor: f, t, d: out };
    }
  });
  return best as { vi: number; side: number; floor: number; t: number; d: number } | null;
}

/** Houses whose wall a walkway reaches: the door node for each, used to give the house villagers. */
export function villagerHomes(world: World): Home[] {
  const live = [...world.nodes.values()].filter(n => world.edgesOf(n.id).length).sort((a, b) => (a.id < b.id ? -1 : 1));
  const out: Home[] = [];
  for (const h of world.houses.values()) {
    const near = live.filter(n => nearWalls(h, n.x, n.z));
    if (!near.length) continue;
    const base = houseLayout(world, h).base;
    const door = near.find(n => nodeWall(h, n, base));
    if (door) out.push({ house: h.id, node: door.id, seed: h.seed, size: h.volumes.reduce((s, v) => s + v.floors, 0) >= 3 ? 2 : 1 });
  }
  return out;
}

/** The hanging lantern of every lookout, in world space: where the smugglers' signal shows. */
export function lookoutLanterns(world: World): { house: string; x: number; y: number; z: number }[] {
  const out: { house: string; x: number; y: number; z: number }[] = [];
  for (const h of world.houses.values()) {
    let base: number | null = null;
    for (const v of h.volumes) {
      if (vkind(v) !== "lookout") continue;
      base ??= houseLayout(world, h).base;
      const y = base + Math.max(1, v.floors - 1) * FLOOR_H + FLOOR_H * 1.1 - 0.35;
      out.push({ house: h.id, x: (v.x0 + v.x1) / 2, y, z: (v.z0 + v.z1) / 2 });
    }
  }
  return out.sort((a, b) => (a.house < b.house ? -1 : 1));
}

export function houseLayout(world: World, h: House): Layout {
  const { gmin, gmax, over } = houseGround(world, h);
  let base: number, stilts = false, plinth = false, rock = false;
  if (h.foundation === "stilts") { base = Math.max(DECK_Y, gmax + 0.8); stilts = true; }
  else if (h.foundation === "rock" || (h.foundation === "auto" && !over && gmax - gmin > 1.1)) {
    // perched on a sandstone outcrop, keyed into the slope: the floor sits a little below the high side
    base = Math.max(gmin + PLINTH, gmax - Math.min(1.6, (gmax - gmin) * 0.55)); rock = true;
    if (over) base = Math.max(base, DECK_Y);
  }
  else if (h.foundation === "keyed") { base = Math.max(gmin + PLINTH, over ? DECK_Y : -99); plinth = true; stilts = over; }
  else if (over) { base = Math.max(DECK_Y, gmax + PLINTH); stilts = true; }
  else if (gmax - gmin > 0.55) { base = gmax + PLINTH; stilts = true; }
  else { base = gmax + PLINTH; plinth = true; }
  base = Math.round(base * 20) / 20;
  const r = rng(h.seed + 0.37);
  const lean: [number, number] = [(r() - 0.5) * 0.05, (r() - 0.5) * 0.05];
  const doors = walkDoors(world, h, base);
  const bays: Bay[] = [];
  let top = base;
  h.volumes.forEach((v, vi) => {
    const kind = vkind(v);
    const wallFloors = kind === "lookout" ? Math.max(1, v.floors - 1) : v.floors;
    top = Math.max(top, base + v.floors * FLOOR_H);
    for (let f = 0; f < wallFloors; f++) for (let s = 0; s < 4; s++) {
      const L = sideLine(v, s);
      const tx = L.b[0] - L.a[0], tz = L.b[1] - L.a[1], len = Math.hypot(tx, tz);
      const ux = tx / len, uz = tz / len;
      // split the side into runs not covered by another volume of this house
      const seg = 0.25, ns = Math.round(len / seg);
      const open: boolean[] = [];
      for (let k = 0; k < ns; k++) {
        const c = (k + 0.5) * seg;
        const px = L.a[0] + ux * c + L.n[0] * 0.05, pz = L.a[1] + uz * c + L.n[1] * 0.05;
        open.push(!h.volumes.some((o, oi) => oi !== vi && o.floors > f && inside(o, px, pz)));
      }
      let k = 0;
      while (k < ns) {
        if (!open[k]) { k++; continue; }
        let e = k; while (e < ns && open[e]) e++;
        const r0 = k * seg, r1 = e * seg, rl = r1 - r0;
        const nb = Math.max(1, Math.round(rl / 1.15));
        const bw = rl / nb;
        const forced = doors.get(`${vi}:${s}:${f}`);
        for (let b = 0; b < nb; b++) {
          const t0 = r0 + b * bw, t1 = t0 + bw;
          const slot = Math.round((t0 + t1));
          const key = `${s}:${f}:${slot}`;
          let kind2: Bay["kind"] = bw < 0.7 || vkind(v) === "tower" && f === 0 ? "wall" : hsh(h.seed * 13.1 + vi * 7.7 + s * 3.3 + f * 1.9 + slot * 0.71) < 0.64 ? "window" : "wall";
          if (forced !== undefined && forced >= t0 && forced <= t1) kind2 = "door";
          const o = v.openings?.[key];
          if (o) kind2 = o;
          bays.push({
            vi, side: s, floor: f, key, kind: kind2, y0: base + f * FLOOR_H,
            a: [L.a[0] + ux * t0, L.a[1] + uz * t0], b: [L.a[0] + ux * t1, L.a[1] + uz * t1], n: L.n,
          });
        }
        k = e;
      }
    }
  });
  // one front door on the ground floor if nothing else asked for one
  if (!bays.some(b => b.kind === "door" && b.floor === 0)) {
    const cx = N / 2, cz = N * 0.62;
    let best: Bay | null = null, bs = -Infinity;
    for (const b of bays) {
      if (b.floor !== 0 || b.b[0] === b.a[0] && b.b[1] === b.a[1]) continue;
      if (h.volumes[b.vi].openings?.[b.key] === "window" || h.volumes[b.vi].openings?.[b.key] === "wall") continue;
      const mx = (b.a[0] + b.b[0]) / 2, mz = (b.a[1] + b.b[1]) / 2;
      const dx = cx - mx, dz = cz - mz, dl = Math.hypot(dx, dz) || 1;
      const front = world.height(mx + b.n[0] * 0.8, mz + b.n[1] * 0.8);
      const score = (b.n[0] * dx + b.n[1] * dz) / dl - Math.abs(front - (base - PLINTH)) * 0.6 + (b.vi === 0 ? 0.3 : 0) + hsh(b.a[0] * 3 + b.a[1] * 7) * 0.1;
      if (score > bs) { bs = score; best = b; }
    }
    if (best) best.kind = "door";
  }
  // walls that open onto a lower part's flat roof get a terrace door on that floor
  const runs = new Map<string, Bay[]>();
  for (const b of bays) {
    if (b.floor < 1) continue;
    const mx = (b.a[0] + b.b[0]) / 2 + b.n[0] * 0.3, mz = (b.a[1] + b.b[1]) / 2 + b.n[1] * 0.3;
    const o = h.volumes.find((q, qi) => qi !== b.vi && q.floors === b.floor && q.roof === "flat" && (q.kind ?? "room") === "room" && mx > q.x0 && mx < q.x1 && mz > q.z0 && mz < q.z1);
    if (!o) continue;
    const k = `${b.vi}:${b.side}:${b.floor}`;
    if (!runs.has(k)) runs.set(k, []);
    runs.get(k)!.push(b);
  }
  for (const list of runs.values()) {
    if (list.some(b => b.kind === "door")) continue;
    const mid = list[Math.floor((list.length - 1) / 2)];
    if (!h.volumes[mid.vi].openings?.[mid.key]) mid.kind = "door";
  }
  return { base, gmin, gmax, over, stilts, plinth, rock, bays, lean, top, lived: doors.size > 0 };
}

export function buildHouses(world: World): HouseBuild {
  const mb = new MeshBuilder();
  const out: HouseBuild = { mb, lights: [], anchors: [], foam: [] };
  for (const h of world.houses.values()) buildHouse(world, h, out);
  return out;
}

export function buildHouse(world: World, h: House, out: HouseBuild, ghost = false) {
  const mb = out.mb;
  const lay = houseLayout(world, h);
  const pal = PALETTES[h.palette % PALETTES.length];
  const wall = hexRGB(pal.wall), trim = hexRGB(pal.trim), roofC = hexRGB(pal.roof), wood = hexRGB(WOOD), tar = hexRGB(TAR), stone = hexRGB(STONE);
  const r = rng(h.seed);
  const base = lay.base;
  mb.setOwner(`h:${h.id}:0`);

  // ---------- foundations ----------
  mb.xf = null;
  const posts: [number, number][] = [];
  if (lay.stilts) {
    for (const v of h.volumes) {
      const nx = Math.max(1, Math.ceil((v.x1 - v.x0) / 1.4)), nz = Math.max(1, Math.ceil((v.z1 - v.z0) / 1.4));
      for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
        const edge = i === 0 || j === 0 || i === nx || j === nz;
        if (!edge && (nx < 3 || nz < 3 || (i + j) % 2)) continue;
        const x = v.x0 + 0.12 + (v.x1 - v.x0 - 0.24) * i / nx, z = v.z0 + 0.12 + (v.z1 - v.z0 - 0.24) * j / nz;
        if (!posts.some(p => Math.hypot(p[0] - x, p[1] - z) < 0.35)) posts.push([x, z]);
      }
    }
    mb.paint(tar, M.plank);
    for (const [x, z] of posts) {
      const g = world.height(x, z);
      if (base - g < 0.12) continue;
      mb.setOwner(`h:${h.id}:0`);
      mb.cyl(x, z, g - 0.35, base, 0.1, 0.085, 7, false, hsh(x * 9 + z));
      if (g < WATER_Y) out.foam.push({ x, z, r: 0.06 });
    }
    // bracing between neighbouring perimeter posts when they're tall
    mb.paint(hexRGB(WOOD, 0.8), M.plank);
    for (let i = 0; i < posts.length; i++) for (let j = i + 1; j < posts.length; j++) {
      const [ax, az] = posts[i], [bx, bz] = posts[j];
      const d = Math.hypot(ax - bx, az - bz);
      if (d > 1.6 || d < 0.6) continue;
      const ga = world.height(ax, az), gb = world.height(bx, bz);
      const lo = Math.max(ga, gb, WATER_Y - 0.1) + 0.15;
      if (base - lo < 0.9) continue;
      const side: V3 = norm([-(bz - az), 0, bx - ax]);
      mb.beam([ax, lo, az], [bx, base - 0.25, bz], side, 0.03, 0.035);
      if (base - lo > 1.6) mb.beam([bx, lo, bz], [ax, base - 0.25, az], side, 0.03, 0.035);
    }
  }
  for (const v of h.volumes) {
    if (lay.rock) {
      rockBase(mb, world, v, base, lay.gmin, h.seed);
      mb.paint(wood, M.plank);
      mb.box([v.x0 - 0.06, base - 0.12, v.z0 - 0.06], [v.x1 + 0.06, base, v.z1 + 0.06]);
    } else if (lay.plinth) {
      mb.paint(stone, M.stone);
      mb.box([v.x0 - 0.05, lay.gmin - 0.3, v.z0 - 0.05], [v.x1 + 0.05, base, v.z1 + 0.05]);
    } else {
      // floor frame: rim joists + plank underside
      mb.paint(wood, M.plank);
      mb.box([v.x0 - 0.1, base - 0.2, v.z0 - 0.1], [v.x1 + 0.1, base, v.z1 + 0.1]);
    }
  }

  // ---------- walls ----------
  const [lx, lz] = lay.lean;
  mb.xf = (p: V3) => { const k = Math.max(0, p[1] - base); return [p[0] + k * lx, p[1], p[2] + k * lz]; };
  for (const bay of lay.bays) {
    mb.setOwner(`h:${h.id}:${bay.vi}`);
    const v = h.volumes[bay.vi];
    const styleStone = h.style === "stone" && bay.floor === 0 || vkind(v) === "tower";
    const wm = styleStone ? M.stone : h.style === "plank" ? M.plank : M.plaster;
    const wc = styleStone ? stone : wall;
    wallBay(mb, bay, wm, wc, trim, wood, h, r, out, lay.lived);
  }
  // corner posts, floor bands and eave beams (skip for stone)
  h.volumes.forEach((v, vi) => {
    mb.setOwner(`h:${h.id}:${vi}`);
    const kind = vkind(v);
    const wallFloors = kind === "lookout" ? Math.max(1, v.floors - 1) : v.floors;
    const topY = base + wallFloors * FLOOR_H;
    const tc = kind === "tower" ? stone : h.style === "plank" ? hexRGB(pal.trim, 0.9) : wood;
    mb.paint(tc, kind === "tower" ? M.stone : M.plank);
    for (const [x, z] of [[v.x0, v.z0], [v.x1, v.z0], [v.x1, v.z1], [v.x0, v.z1]] as const) {
      if (h.volumes.some((o, oi) => oi !== vi && inside(o, x + Math.sign(x - (v.x0 + v.x1) / 2) * 0.05, z + Math.sign(z - (v.z0 + v.z1) / 2) * 0.05))) continue;
      mb.box([x - 0.08, base, z - 0.08], [x + 0.08, topY + 0.02, z + 0.08]);
    }
    mb.paint(wood, M.plank);
    for (let f = 1; f <= wallFloors; f++) {
      const y = base + f * FLOOR_H;
      const t = f === wallFloors ? 0.14 : 0.09;
      mb.box([v.x0 - 0.05, y - t, v.z0 - 0.05], [v.x1 + 0.05, y, v.z1 + 0.05], "-y");
    }
    // ---------- roofs ----------
    if (kind === "lookout") lookoutTop(mb, v, base, wallFloors, trim, wood, roofC, h, out);
    else roofFor(mb, v, topY, h, r, roofC, wood, wall, trim, out, lay);
    if (kind === "room") for (let sd = 0; sd < 4; sd++) { const L = sideLine(v, sd); (out.faces ??= []).push({ house: h.id, a: L.a, b: L.b, n: L.n, base, floors: wallFloors }); }
    out.anchors.push(...[[v.x0 - 0.1, v.z0 - 0.1], [v.x1 + 0.1, v.z0 - 0.1], [v.x1 + 0.1, v.z1 + 0.1], [v.x0 - 0.1, v.z1 + 0.1]].map(([x, z]) => ({ x, y: topY - 0.1, z, house: h.id })));
  });
  mb.xf = null;
  void ghost; void cross; void sub;
}

/** `lived`: a walkway reaches the house, so someone's home — its windows and door lamp light up at night. */
function wallBay(mb: MeshBuilder, bay: Bay, wm: number, wc: V3, trim: V3, wood: V3, h: House, r: () => number, out: HouseBuild, lived: boolean) {
  const [ax, az] = bay.a, [bx, bz] = bay.b;
  const n: V3 = [bay.n[0], 0, bay.n[1]];
  const bw = Math.hypot(bx - ax, bz - az);
  const u: V3 = [(bx - ax) / bw, 0, (bz - az) / bw];
  const y0 = bay.y0, H = FLOOR_H;
  const P = (s: number, y: number, d = 0): V3 => [ax + u[0] * s + n[0] * d, y, az + u[2] * s + n[2] * d];
  const uOff = bay.side % 2 ? az : ax;
  const rect = (s0: number, s1: number, v0: number, v1: number) => {
    if (s1 - s0 < 1e-3 || v1 - v0 < 1e-3) return;
    mb.quad([P(s0, y0 + v0), P(s1, y0 + v0), P(s1, y0 + v1), P(s0, y0 + v1)], n,
      [[uOff + s0, y0 + v0], [uOff + s1, y0 + v0], [uOff + s1, y0 + v1], [uOff + s0, y0 + v1]]);
  };
  mb.paint(wc, wm);
  if (bay.kind === "wall") { rect(0, bw, 0, H); return; }
  const isDoor = bay.kind === "door";
  const ow = isDoor ? Math.min(0.56, bw - 0.3) : Math.min(0.5, bw * 0.48);
  const oh = isDoor ? 0.9 : 0.52;
  const v0 = isDoor ? 0 : 0.42, v1 = v0 + oh;
  const s0 = (bw - ow) / 2, s1 = s0 + ow;
  rect(0, s0, 0, H); rect(s1, bw, 0, H); rect(s0, s1, 0, v0); rect(s0, s1, v1, H);
  const dep = -0.08;
  // reveals
  mb.quad([P(s0, y0 + v0), P(s0, y0 + v1), P(s0, y0 + v1, dep), P(s0, y0 + v0, dep)], u);
  mb.quad([P(s1, y0 + v0), P(s1, y0 + v1), P(s1, y0 + v1, dep), P(s1, y0 + v0, dep)], scl(u, -1));
  mb.quad([P(s0, y0 + v1), P(s1, y0 + v1), P(s1, y0 + v1, dep), P(s0, y0 + v1, dep)], [0, -1, 0]);
  if (!isDoor) mb.quad([P(s0, y0 + v0), P(s1, y0 + v0), P(s1, y0 + v0, dep), P(s0, y0 + v0, dep)], [0, 1, 0]);
  const mid = P((s0 + s1) / 2, y0 + (v0 + v1) / 2, 0.3);
  if (isDoor) {
    mb.paint(trim, M.plank);
    mb.quad([P(s0, y0 + v0, dep), P(s1, y0 + v0, dep), P(s1, y0 + v1, dep), P(s0, y0 + v1, dep)], n,
      [[0, 0], [0, ow], [oh, ow], [oh, 0]].map(([a, b]) => [b * 1.0, a] as [number, number]));
    // little awning over the door
    mb.paint(h.awning ? hexRGB("#e9dcbc") : wood, h.awning ? M.cloth : M.plank);
    const aw = 0.36;
    mb.quad([P(s0 - 0.12, y0 + v1 + 0.2), P(s1 + 0.12, y0 + v1 + 0.2), P(s1 + 0.12, y0 + v1 + 0.08, aw), P(s0 - 0.12, y0 + v1 + 0.08, aw)], [0, 1, 0]);
    mb.quad([P(s0 - 0.12, y0 + v1 + 0.2), P(s1 + 0.12, y0 + v1 + 0.2), P(s1 + 0.12, y0 + v1 + 0.08, aw), P(s0 - 0.12, y0 + v1 + 0.08, aw)], [0, -1, 0]);
    // wall lantern
    const lp = P(s1 + 0.18, y0 + v1 - 0.05, 0.08);
    mb.paint(hexRGB("#2e2a26"), M.metal); mb.box([lp[0] - 0.06, lp[1] + 0.12, lp[2] - 0.06], [lp[0] + 0.06, lp[1] + 0.15, lp[2] + 0.06]);
    mb.paint(lived ? hexRGB("#ffd08a") : hexRGB("#6d6658"), lived ? M.lamp : M.unlit); mb.box([lp[0] - 0.045, lp[1] - 0.04, lp[2] - 0.045], [lp[0] + 0.045, lp[1] + 0.12, lp[2] + 0.045]);
    if (lived) out.lights.push({ x: lp[0], y: lp[1], z: lp[2], r: 2.4, i: 0.75 });
  } else {
    mb.paint([0.2, 0.3, 0.33], lived ? M.glass : M.unlit);
    mb.quad([P(s0, y0 + v0, dep), P(s1, y0 + v0, dep), P(s1, y0 + v1, dep), P(s0, y0 + v1, dep)], n);
    // mullion cross
    mb.paint(trim, M.plank);
    const mc = (s0 + s1) / 2;
    mb.quad([P(mc - 0.018, y0 + v0, dep + 0.01), P(mc + 0.018, y0 + v0, dep + 0.01), P(mc + 0.018, y0 + v1, dep + 0.01), P(mc - 0.018, y0 + v1, dep + 0.01)], n);
    if (lived) out.lights.push({ x: mid[0], y: mid[1], z: mid[2], r: 1.5, i: 0.28 });
    if (h.shutters && bw > 1.0) {
      const sw = ow * 0.5 - 0.01;
      for (const [a, b] of [[s0 - 0.04 - sw, s0 - 0.04], [s1 + 0.04, s1 + 0.04 + sw]]) {
        mb.quad([P(a, y0 + v0 - 0.02, 0.03), P(b, y0 + v0 - 0.02, 0.03), P(b, y0 + v1 + 0.02, 0.03), P(a, y0 + v1 + 0.02, 0.03)], n,
          [[a * 1, 0], [b * 1, 0], [b * 1, 0.4], [a * 1, 0.4]].map(([x, y]) => [y + x * 0.02, x * 4] as [number, number]));
      }
    }
    // sill
    mb.paint(hexRGB("#e8dcc2"), M.plain);
    // top sits just proud of the reveal floor so the two never share a plane
    const st = y0 + v0 + 0.012;
    mb.box(minV(P(s0 - 0.06, y0 + v0 - 0.05, -0.02), P(s1 + 0.06, st, 0.08)), maxV(P(s0 - 0.06, y0 + v0 - 0.05, -0.02), P(s1 + 0.06, st, 0.08)));
    if (h.boxes && hsh(ax * 3.1 + az * 5.7 + bay.floor) < 0.55) flowerBox(mb, P(s0, y0 + v0 - 0.05, 0), P(s1, y0 + v0 - 0.05, 0), n, r);
  }
  // chunky frame
  mb.paint(trim, M.plank);
  const fr = 0.05;
  const fb = (sa: number, sb: number, va: number, vb: number) => mb.box(minV(P(sa, y0 + va, 0), P(sb, y0 + vb, 0.035)), maxV(P(sa, y0 + va, 0), P(sb, y0 + vb, 0.035)));
  fb(s0 - fr, s0, v0, v1 + fr); fb(s1, s1 + fr, v0, v1 + fr); fb(s0 - fr, s1 + fr, v1, v1 + fr);
}
const minV = (a: V3, b: V3): V3 => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
const maxV = (a: V3, b: V3): V3 => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];

function flowerBox(mb: MeshBuilder, a: V3, b: V3, n: V3, r: () => number) {
  const lo = add(a, scl(n, 0.02)), hi = add(add(b, scl(n, 0.16)), [0, -0.14, 0]);
  mb.paint(hexRGB("#8a5a3a"), M.plank);
  mb.box(minV(lo, hi), maxV(lo, hi));
  const k = 3;
  for (let i = 0; i < k; i++) {
    const t = (i + 0.5) / k;
    const c = add(lerp3(a, b, t), add(scl(n, 0.1), [0, 0.02, 0]));
    mb.paint(hexRGB("#6f8a45"), M.leaf); mb.blob(c, [0.1, 0.08, 0.08], r() * 100, 0);
    if (r() < 0.8) { mb.paint(hexRGB(r() < 0.6 ? "#c9577a" : "#e08a4a"), M.leaf); mb.blob(add(c, [0, 0.05, 0.02]), [0.05, 0.04, 0.05], r() * 100, 0); }
  }
}

/** Roof profile: t=0 at the eave, 1 at the ridge. Negative curve = upswept (concave) eaves. */
const profile = (t: number, curve: number) => t + curve * 0.22 * Math.sin(Math.PI * t) + (curve < 0 ? -curve * 0.06 * (1 - t) * (1 - t) * (1 - t) : 0);

function roofFor(mb: MeshBuilder, v: Volume, yb: number, h: House, r: () => number, roofC: V3, wood: V3, wall: V3, trim: V3, out: HouseBuild, lay: Layout) {
  const kind = vkind(v);
  const w = v.x1 - v.x0, d = v.z1 - v.z0;
  const alongX = v.ridgeX ?? w >= d;
  const span = alongX ? d : w;
  const pitch = kind === "tower" ? Math.max(1.4, v.pitch) : v.pitch;
  const ov = v.overhang;
  const roofType = kind === "tower" ? "hip" : v.roof;
  if (roofType === "flat") { flatRoof(mb, v, yb, h, wall, trim, wood, r); return; }
  const H = (roofType === "shed" ? span * 0.42 : span * 0.5) * 0.95 * pitch;
  const half = span / 2;
  const drop = Math.min(0.2, ov * H / (roofType === "shed" ? span : half));
  const yE = yb + 0.06 - drop;
  const Ht = H + drop;
  // local frame: a = along the ridge, c = across it
  const A: V3 = alongX ? [1, 0, 0] : [0, 0, 1], C: V3 = alongX ? [0, 0, 1] : [1, 0, 0];
  const cx = (v.x0 + v.x1) / 2, cz = (v.z0 + v.z1) / 2;
  const lenA = alongX ? w : d;
  const W = (a: number, c: number, y: number): V3 => [cx + A[0] * a + C[0] * c, y, cz + A[2] * a + C[2] * c];
  const rows = 7;
  const tile = roofC, under = hexRGB("#6b4a33");
  const plane = (E0: V3, E1: V3, R0: V3, R1: V3, out3: V3, lenFn: number) => {
    // rows from eave (t=0) to ridge (t=1); y from the profile
    const pts: V3[][] = [];
    for (let k = 0; k <= rows; k++) {
      const t = k / rows;
      const y = yE + Ht * profile(t, v.curve);
      const p0 = lerp3(E0, R0, t), p1 = lerp3(E1, R1, t);
      pts.push([[p0[0], y, p0[2]], [p1[0], y, p1[2]]]);
    }
    for (let k = 0; k < rows; k++) {
      const [a0, a1] = pts[k], [b0, b1] = pts[k + 1];
      const s0 = (k / rows) * lenFn, s1 = ((k + 1) / rows) * lenFn;
      const ua0 = dotA(a0), ua1 = dotA(a1), ub0 = dotA(b0), ub1 = dotA(b1);
      mb.paint(tile, M.tile);
      mb.quad([a0, a1, b1, b0], add(out3, [0, 1.5, 0]), [[ua0, lenFn - s0], [ua1, lenFn - s0], [ub1, lenFn - s1], [ub0, lenFn - s1]]);
      mb.paint(under, M.plank);
      const dn = (p: V3): V3 => [p[0], p[1] - 0.08, p[2]];
      mb.quad([dn(a0), dn(a1), dn(b1), dn(b0)], [0, -1, 0]);
    }
    // fascia along the eave
    mb.paint(wood, M.plank);
    const [e0, e1] = pts[0];
    mb.quad([e0, e1, [e1[0], e1[1] - 0.13, e1[2]], [e0[0], e0[1] - 0.13, e0[2]]], out3);
    return pts;
  };
  const dotA = (p: V3) => p[0] * A[0] + p[2] * A[2] + (p[0] * C[0] + p[2] * C[2]) * 0.0;
  const endOv = ov * 0.7;
  const ridgeY = yE + Ht * profile(1, v.curve);
  if (roofType === "gable" || roofType === "shed") {
    const aL = -lenA / 2 - endOv, aR = lenA / 2 + endOv;
    const slopes: { cE: number; cR: number; out: V3 }[] = roofType === "gable"
      ? [{ cE: half + ov, cR: 0, out: C }, { cE: -half - ov, cR: 0, out: scl(C, -1) }]
      : [{ cE: half + ov, cR: -half - 0.05, out: C }];
    for (const s of slopes) {
      const pts = plane(W(aL, s.cE, 0), W(aR, s.cE, 0), W(aL, s.cR, 0), W(aR, s.cR, 0), s.out, Math.abs(s.cE - s.cR));
      // barge boards along both verges (chunky, trim coloured)
      mb.paint(trim, M.plank);
      for (let k = 0; k < rows; k++) for (const e of [0, 1]) {
        const p = pts[k][e], q = pts[k + 1][e];
        const dir: V3 = e === 0 ? scl(A, -1) : A;
        mb.quad([[p[0], p[1] + 0.03, p[2]], [q[0], q[1] + 0.03, q[2]], [q[0], q[1] - 0.14, q[2]], [p[0], p[1] - 0.14, p[2]]], dir);
      }
      // gable-end walls under this slope, clipped to the wall line
      mb.paint(h.style === "plank" ? hexRGB(PALETTES[h.palette % PALETTES.length].wall) : wall, h.style === "plank" ? M.plank : M.plaster);
      for (const aw of [-lenA / 2, lenA / 2]) {
        const dir: V3 = aw < 0 ? scl(A, -1) : A;
        for (let k = 0; k < rows; k++) {
          const ca = s.cE + (s.cR - s.cE) * (k / rows), cb = s.cE + (s.cR - s.cE) * ((k + 1) / rows);
          const lo = Math.min(Math.abs(ca), Math.abs(cb)), hi = Math.max(Math.abs(ca), Math.abs(cb));
          if (lo >= half) continue;
          const clip = (c: number) => Math.sign(c) * Math.min(Math.abs(c), half);
          const c0 = clip(ca), c1 = clip(cb);
          const yAt = (c: number) => { const t = (c - s.cE) / (s.cR - s.cE); return yE + Ht * profile(Math.min(1, Math.max(0, t)), v.curve) - 0.08; };
          void hi;
          mb.quad([W(aw, c0, yb), W(aw, c1, yb), W(aw, c1, yAt(c1)), W(aw, c0, yAt(c0))], dir);
        }
      }
      if (roofType === "shed") {
        // back wall up to the high side
        const cB = -half;
        mb.quad([W(-lenA / 2, cB, yb), W(lenA / 2, cB, yb), W(lenA / 2, cB, ridgeY - 0.08), W(-lenA / 2, cB, ridgeY - 0.08)], scl(C, -1));
      }
    }
    if (roofType === "gable") {
      mb.paint(hexRGB(PALETTES[h.palette % PALETTES.length].roof, 0.78), M.tile);
      mb.beam(W(aL - 0.02, 0, ridgeY + 0.02), W(aR + 0.02, 0, ridgeY + 0.02), C, 0.09, 0.07);
    }
  } else {
    // hip: four planes meeting a (possibly zero-length) ridge
    const ridgeHalf = Math.max(0, lenA / 2 - half);
    const eA = lenA / 2 + ov, eC = half + ov;
    const R0 = W(-ridgeHalf, 0, 0), R1 = W(ridgeHalf, 0, 0);
    plane(W(-eA, eC, 0), W(eA, eC, 0), R0, R1, C, eC);
    plane(W(eA, -eC, 0), W(-eA, -eC, 0), R1, R0, scl(C, -1), eC);
    plane(W(eA, eC, 0), W(eA, -eC, 0), R1, R1, A, eC);
    plane(W(-eA, -eC, 0), W(-eA, eC, 0), R0, R0, scl(A, -1), eC);
    mb.paint(hexRGB(PALETTES[h.palette % PALETTES.length].roof, 0.78), M.tile);
    if (ridgeHalf > 0.05) mb.beam(W(-ridgeHalf, 0, ridgeY + 0.02), W(ridgeHalf, 0, ridgeY + 0.02), C, 0.08, 0.06);
    if (kind === "tower") {
      mb.paint(hexRGB("#3a3430"), M.metal);
      mb.cyl(cx, cz, ridgeY, ridgeY + 0.5, 0.03, 0.01, 5);
    }
  }
  // chimney
  if (kind !== "tower" && hsh(h.seed * 3.3 + v.x0 * 1.3 + v.z0 * 2.1) < 0.6 && lenA > 1.6) {
    const a = (hsh(h.seed + v.x1) < 0.5 ? -1 : 1) * lenA * 0.28;
    const c = half * 0.35;
    const t = 1 - c / (half + ov);
    const yRoof = yE + Ht * profile(t, v.curve);
    const p = W(a, c, 0);
    mb.paint(hexRGB(PALETTES[h.palette % PALETTES.length].wall, 1.05), M.plaster);
    mb.box([p[0] - 0.17, yRoof - 0.4, p[2] - 0.17], [p[0] + 0.17, ridgeY + 0.45, p[2] + 0.17]);
    mb.paint(hexRGB("#8d7f6c"), M.stone);
    mb.box([p[0] - 0.21, ridgeY + 0.45, p[2] - 0.21], [p[0] + 0.21, ridgeY + 0.52, p[2] + 0.21]);
    mb.paint(hexRGB("#a55a3a"), M.plain);
    mb.cyl(p[0], p[2], ridgeY + 0.52, ridgeY + 0.66, 0.06, 0.05, 6);
  }
  void r; void out; void lay;
}

function flatRoof(mb: MeshBuilder, v: Volume, yb: number, h: House, wall: V3, trim: V3, wood: V3, r: () => number) {
  const o = 0.06, pt = 0.12, ph = 0.36, yp = yb - 0.03;
  // the deck sits inside the parapet so no faces share a plane
  const ins = o - pt + 0.02;
  mb.paint(hexRGB("#d9c9a8"), M.plaster);
  mb.box([v.x0 + ins, yb - 0.02, v.z0 + ins], [v.x1 - ins, yb + 0.08, v.z1 - ins]);
  // parapet
  mb.paint(wall, h.style === "plank" ? M.plank : M.plaster);
  mb.box([v.x0 - o, yp, v.z0 - o], [v.x1 + o, yb + ph, v.z0 - o + pt]);
  mb.box([v.x0 - o, yp, v.z1 + o - pt], [v.x1 + o, yb + ph, v.z1 + o]);
  mb.box([v.x0 - o, yp, v.z0 - o + pt], [v.x0 - o + pt, yb + ph, v.z1 + o - pt]);
  mb.box([v.x1 + o - pt, yp, v.z0 - o + pt], [v.x1 + o, yb + ph, v.z1 + o - pt]);
  mb.paint(hexRGB("#efe4cc"), M.plain);
  mb.box([v.x0 - o - 0.03, yb + ph, v.z0 - o - 0.03], [v.x1 + o + 0.03, yb + ph + 0.05, v.z1 + o + 0.03]);
  // pots on the terrace
  for (let i = 0; i < 2; i++) {
    const x = v.x0 + 0.35 + r() * (v.x1 - v.x0 - 0.7), z = v.z0 + 0.35 + r() * (v.z1 - v.z0 - 0.7);
    mb.paint(hexRGB("#b5603c"), M.plain); mb.cyl(x, z, yb + 0.08, yb + 0.28, 0.1, 0.13, 7);
    mb.paint(hexRGB("#6f8a45"), M.leaf); mb.blob([x, yb + 0.38, z], [0.18, 0.16, 0.18], r() * 50, 0);
    if (r() < 0.6) { mb.paint(hexRGB("#c9577a"), M.leaf); mb.blob([x + 0.05, yb + 0.46, z], [0.08, 0.07, 0.08], r() * 50, 0); }
  }
  if (h.awning) {
    // a canvas awning on four poles over part of the terrace
    const x0 = v.x0 + 0.15, x1 = Math.min(v.x1 - 0.15, x0 + 1.8), z0 = v.z0 + 0.15, z1 = Math.min(v.z1 - 0.15, z0 + 1.4);
    mb.paint(wood, M.plank);
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) mb.cyl(x, z, yb + 0.08, yb + 1.0, 0.035, 0.035, 5);
    mb.paint(trim, M.cloth);
    mb.quad([[x0, yb + 1.0, z0], [x1, yb + 1.0, z0], [x1, yb + 0.9, z1], [x0, yb + 0.9, z1]], [0, 1, 0]);
    mb.quad([[x0, yb + 1.0, z0], [x1, yb + 1.0, z0], [x1, yb + 0.9, z1], [x0, yb + 0.9, z1]], [0, -1, 0]);
  }
}

function lookoutTop(mb: MeshBuilder, v: Volume, base: number, wallFloors: number, trim: V3, wood: V3, roofC: V3, h: House, out: HouseBuild) {
  const y = base + wallFloors * FLOOR_H;
  const o = 0.35;
  const x0 = v.x0 - o, x1 = v.x1 + o, z0 = v.z0 - o, z1 = v.z1 + o;
  mb.paint(wood, M.plank);
  mb.box([x0, y - 0.1, z0], [x1, y + 0.05, z1]);
  // brackets under the overhang
  for (const [x, z] of [[v.x0, v.z0], [v.x1, v.z0], [v.x1, v.z1], [v.x0, v.z1]]) {
    const dx = Math.sign(x - (v.x0 + v.x1) / 2), dz = Math.sign(z - (v.z0 + v.z1) / 2);
    mb.beam([x, y - 0.7, z], [x + dx * o * 0.9, y - 0.08, z + dz * o * 0.9], [dz, 0, -dx], 0.04, 0.04);
  }
  const yt = y + FLOOR_H * 1.1;
  for (const [x, z] of [[x0 + 0.08, z0 + 0.08], [x1 - 0.08, z0 + 0.08], [x1 - 0.08, z1 - 0.08], [x0 + 0.08, z1 - 0.08]]) mb.box([x - 0.06, y, z - 0.06], [x + 0.06, yt, z + 0.06]);
  // rail + rope
  mb.paint(hexRGB("#b89a70"), M.cloth);
  const rails: [V3, V3][] = [[[x0, 0, z0], [x1, 0, z0]], [[x1, 0, z0], [x1, 0, z1]], [[x1, 0, z1], [x0, 0, z1]], [[x0, 0, z1], [x0, 0, z0]]];
  for (const [a, b] of rails) {
    const pts: V3[] = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; const p = lerp3(a, b, t); pts.push([p[0], y + 0.55 - Math.sin(Math.PI * t) * 0.07, p[2]]); }
    mb.tube(pts, 0.022, 4);
  }
  // pyramid roof on posts
  const ov = 0.2, H = Math.max(x1 - x0, z1 - z0) * 0.55;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const E = [[x0 - ov, z0 - ov], [x1 + ov, z0 - ov], [x1 + ov, z1 + ov], [x0 - ov, z1 + ov]];
  mb.paint(roofC, M.tile);
  for (let i = 0; i < 4; i++) {
    const [ax, az] = E[i], [bx, bz] = E[(i + 1) % 4];
    const out3: V3 = [(ax + bx) / 2 - cx, 0.5, (az + bz) / 2 - cz];
    mb.tri([[ax, yt, az], [bx, yt, bz], [cx, yt + H, cz]], out3);
    mb.tri([[ax, yt - 0.06, az], [bx, yt - 0.06, bz], [cx, yt + H - 0.06, cz]], [0, -1, 0]);
  }
  // pennant
  mb.paint(hexRGB("#3a3430"), M.metal); mb.cyl(cx, cz, yt + H - 0.1, yt + H + 0.9, 0.025, 0.02, 5);
  mb.paint(trim, M.cloth);
  mb.tri([[cx, yt + H + 0.88, cz], [cx, yt + H + 0.6, cz], [cx + 0.55, yt + H + 0.76, cz + 0.08]], [0, 0, 1]);
  mb.tri([[cx, yt + H + 0.88, cz], [cx, yt + H + 0.6, cz], [cx + 0.55, yt + H + 0.76, cz + 0.08]], [0, 0, -1]);
  // a hanging lantern
  mb.paint(hexRGB("#ffd08a"), M.lamp); mb.box([cx - 0.07, yt - 0.45, cz - 0.07], [cx + 0.07, yt - 0.25, cz + 0.07]);
  out.lights.push({ x: cx, y: yt - 0.35, z: cz, r: 3, i: 0.8 });
  void h;
}

export function makeHouse(id: string, seed: number, volumes: Volume[], palette?: number): House {
  const r = rng(seed + 11);
  return {
    id, seed, palette: palette ?? Math.floor(r() * PALETTES.length), style: r() < 0.35 ? "plank" : "plaster", volumes,
    foundation: "auto", shutters: r() < 0.75, boxes: r() < 0.7, awning: r() < 0.5,
  };
}

/** A sandstone outcrop under a house: a noisy, rounded, stepped pedestal flaring into the slope,
 *  plus boulder shoulders hugging any wall that backs onto higher ground. */
function rockBase(mb: MeshBuilder, world: World, v: Volume, base: number, gmin: number, seed: number) {
  const cx = (v.x0 + v.x1) / 2, cz = (v.z0 + v.z1) / 2, hw = (v.x1 - v.x0) / 2, hd = (v.z1 - v.z0) / 2;
  const M_ = 28, K = 7;
  const y0 = gmin - 0.8, y1 = base - 0.05;
  const ring = (k: number): V3[] => {
    const t = k / K; // 0 bottom .. 1 top
    const y = y0 + (y1 - y0) * t;
    const pts: V3[] = [];
    for (let i = 0; i < M_; i++) {
      const th = (i / M_) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      const step = (k % 2) * 0.07; // stepped strata ledges
      const off = 0.14 + Math.pow(1 - t, 1.6) * 1.0 + step + (fbm(th * 1.7 + seed * 9, t * 2.3 + cx * 0.3) - 0.5) * 0.45;
      const px = cx + (hw + off) * Math.sign(c) * Math.pow(Math.abs(c), 0.35);
      const pz = cz + (hd + off) * Math.sign(s) * Math.pow(Math.abs(s), 0.35);
      pts.push([px, k === K ? y1 : y + (fbm(th * 3.1, t * 5 + seed) - 0.5) * 0.18, pz]);
    }
    return pts;
  };
  const rings = Array.from({ length: K + 1 }, (_, k) => ring(k));
  mb.paint(hexRGB("#dba46b"), M.rock);
  for (let k = 0; k < K; k++) for (let i = 0; i < M_; i++) {
    const a = rings[k][i], b = rings[k][(i + 1) % M_], c = rings[k + 1][(i + 1) % M_], d = rings[k + 1][i];
    const mid = lerp3(lerp3(a, b, 0.5), lerp3(c, d, 0.5), 0.5);
    mb.quad([a, b, c, d], [mid[0] - cx, 0, mid[2] - cz]);
  }
  const top = rings[K];
  for (let i = 0; i < M_; i++) mb.tri([[cx, y1, cz], top[i], top[(i + 1) % M_]], [0, 1, 0]);
  // boulder shoulders on walls that back onto higher ground
  for (let s = 0; s < 4; s++) {
    const L = sideLine(v, s);
    const len = Math.hypot(L.b[0] - L.a[0], L.b[1] - L.a[1]);
    const n = Math.max(2, Math.round(len / 0.9));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const px = L.a[0] + (L.b[0] - L.a[0]) * t, pz = L.a[1] + (L.b[1] - L.a[1]) * t;
      const out = world.height(Math.min(N, Math.max(0, px + L.n[0] * 1.3)), Math.min(N, Math.max(0, pz + L.n[1] * 1.3)));
      if (out < base + 0.35) continue;
      const topY = Math.min(out, base + FLOOR_H * 1.6);
      const r = rng(seed * 31 + i * 7 + s);
      const hgt = (topY - base) * 0.5 + 0.25;
      mb.blob([px + L.n[0] * (0.45 + r() * 0.2), base + hgt * 0.8, pz + L.n[1] * (0.45 + r() * 0.2)], [0.55 + r() * 0.3, hgt, 0.55 + r() * 0.3], r() * 99, 1);
    }
  }
}
