import { FLOOR_H, PLINTH, DECK_Y, WATER_Y, N, type World, type House, type Volume, type WalkNode } from "./world.ts";
import { rng, hsh } from "./random.ts";
import type { Home } from "./villagers.ts";

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
export const inside = (v: Volume, x: number, z: number) => x > v.x0 + 1e-3 && x < v.x1 - 1e-3 && z > v.z0 + 1e-3 && z < v.z1 - 1e-3;
export const vkind = (v: Volume) => v.kind ?? "room";

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

/** Steepest drop a new or moved house may straddle: past this it hangs off a cliff on a pillar. */
export const MAX_SITE_DROP = 3;
/** How far the ground falls away across the footprint, counting water as the floor of the drop. */
export function siteDrop(world: World, h: House) {
  const { gmin, gmax } = houseGround(world, h);
  return gmax - Math.max(gmin, WATER_Y);
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
    // never so deep the hill climbs past the lowest storey's windows
    const sink = Math.min(1.6, Math.min(...h.volumes.map(v => v.floors)) * FLOOR_H - 0.75);
    base = Math.max(gmin + PLINTH, gmax - Math.min(sink, (gmax - gmin) * 0.55)); rock = true;
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

export function makeHouse(id: string, seed: number, volumes: Volume[], palette?: number): House {
  const r = rng(seed + 11);
  return {
    id, seed, palette: palette ?? Math.floor(r() * PALETTES.length), style: r() < 0.35 ? "plank" : "plaster", volumes,
    foundation: "auto", shutters: r() < 0.75, boxes: r() < 0.7, awning: r() < 0.5,
  };
}
