import { newVolume, snap, FLOOR_H, type House, type Volume, type WalkNode, type World, type RoofType, type WallStyle, type Foundation } from "./world.ts";
import { houseLayout, nearWalls, nodeWall, sideLine, siteDrop, MAX_SITE_DROP } from "./house-model.ts";

/** Player-facing edits create new records. The world is changed only after a valid candidate exists. */
export type HouseEdit =
  | { kind: "roof"; value: RoofType }
  | { kind: "pitch" | "curve" | "overhang" | "floors" | "palette"; value: number }
  | { kind: "style"; value: WallStyle }
  | { kind: "foundation"; value: Foundation }
  | { kind: "ridge" }
  | { kind: "toggle"; value: "shutters" | "boxes" | "awning" }
  | { kind: "reroll"; value: number }
  | { kind: "kind"; value: Volume["kind"] | "room" }
  | { kind: "wing"; value: "room" | "tower" | "lookout" | "shed" };

export function editHouse(world: World, house: House, vi: number, edit: HouseEdit): { house: House; vi: number } | null {
  const next = structuredClone(house);
  const v = next.volumes[vi] ?? next.volumes[0];
  if (!v) return null;
  switch (edit.kind) {
    case "roof": if (!["gable", "hip", "flat", "shed"].includes(edit.value)) return null; v.roof = edit.value; break;
    case "pitch": if (!Number.isFinite(edit.value) || edit.value < 0.5 || edit.value > 1.6) return null; v.pitch = edit.value; break;
    case "curve": if (!Number.isFinite(edit.value) || edit.value < -1 || edit.value > 1) return null; v.curve = edit.value; break;
    case "overhang": if (!Number.isFinite(edit.value) || edit.value < 0.05 || edit.value > 0.45) return null; v.overhang = edit.value; break;
    case "floors": if (!Number.isFinite(edit.value)) return null; v.floors = Math.max(1, Math.min(4, v.floors + edit.value)); break;
    case "palette": if (!Number.isInteger(edit.value) || edit.value < 0 || edit.value > 7) return null; next.palette = edit.value; break;
    case "style": if (!["plaster", "plank", "stone"].includes(edit.value)) return null; next.style = edit.value; break;
    case "foundation": if (!["auto", "stilts", "keyed", "rock"].includes(edit.value)) return null; next.foundation = edit.value; break;
    case "ridge": v.ridgeX = !(v.ridgeX ?? (v.x1 - v.x0 >= v.z1 - v.z0)); break;
    case "toggle": if (!["shutters", "boxes", "awning"].includes(edit.value)) return null; next[edit.value] = !next[edit.value]; break;
    case "reroll": if (!Number.isFinite(edit.value)) return null; next.seed = edit.value; next.volumes = next.volumes.map(vol => ({ ...vol, openings: undefined })); break;
    case "kind": if (edit.value !== "room" && edit.value !== "tower" && edit.value !== "lookout") return null; v.kind = edit.value === "room" ? undefined : edit.value; break;
    case "wing": {
      const wing = findWing(world, house, vi, edit.value);
      if (!wing) return null;
      next.volumes.push(wing);
      vi = next.volumes.length - 1;
    }
  }
  return { house: next, vi };
}

function findWing(world: World, h: House, vi: number, kind: "room" | "tower" | "lookout" | "shed"): Volume | null {
  const main = h.volumes[vi] ?? h.volumes[0];
  const size = kind === "shed" ? [2, 1.5] : kind === "room" ? [2.5, 2] : [2, 2];
  const sides: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  for (const [nx, nz] of sides) {
    const alongX = nz !== 0, [len, dep] = size;
    const mid = alongX ? snap((main.x0 + main.x1) / 2) : snap((main.z0 + main.z1) / 2);
    for (const shift of [0, -1, 1, -1.5, 1.5]) {
      const c = mid + shift;
      const r = alongX
        ? { x0: snap(c - len / 2), x1: snap(c - len / 2) + len, z0: nz > 0 ? main.z1 : main.z0 - dep, z1: nz > 0 ? main.z1 + dep : main.z0 }
        : { z0: snap(c - len / 2), z1: snap(c - len / 2) + len, x0: nx > 0 ? main.x1 : main.x0 - dep, x1: nx > 0 ? main.x1 + dep : main.x0 };
      if (!world.footprintFree(r.x0, r.z0, r.x1, r.z1)) continue;
      if (h.volumes.some(o => r.x0 < o.x1 - 0.01 && r.x1 > o.x0 + 0.01 && r.z0 < o.z1 - 0.01 && r.z1 > o.z0 + 0.01)) continue;
      const v = newVolume(r.x0, r.z0, r.x1, r.z1, kind === "shed" ? 1 : kind === "room" ? Math.max(1, main.floors - 1) : main.floors + 1, kind === "shed" ? "shed" : kind === "room" ? "gable" : "hip");
      if (siteDrop(world, { ...h, volumes: [...h.volumes, v] }) > Math.max(MAX_SITE_DROP, siteDrop(world, h)) + 1e-6) continue;
      if (kind === "shed") v.ridgeX = !alongX;
      if (kind === "tower" || kind === "lookout") v.kind = kind;
      return v;
    }
  }
  return null;
}

export interface DoorEnd { id: string; vi: number; side: number; t: number; d: number; floor: number }

export function doorEnds(world: World, h: House): DoorEnd[] {
  const base = houseLayout(world, h).base, out: DoorEnd[] = [];
  for (const n of world.nodes.values()) {
    if (!world.edgesOf(n.id).length || !nearWalls(h, n.x, n.z)) continue;
    const hit = nodeWall(h, n, base);
    if (hit) out.push({ id: n.id, vi: hit.vi, side: hit.side, t: hit.t, d: hit.d, floor: hit.floor });
  }
  return out;
}

export function followedDoors(world: World, h: House, orig: House, doors: DoorEnd[]): WalkNode[] {
  if (!doors.length) return [];
  const base = houseLayout(world, h).base, updated: WalkNode[] = [];
  for (const dr of doors) {
    const n = world.nodes.get(dr.id), v = h.volumes[dr.vi], ov = orig.volumes[dr.vi];
    if (!n || !v || !ov) continue;
    const alongX = dr.side % 2 === 0;
    const lo = alongX ? v.x0 : v.z0, hi = alongX ? v.x1 : v.z1;
    const olo = alongX ? ov.x0 : ov.z0, ohi = alongX ? ov.x1 : ov.z1;
    const shift = Math.abs((lo - olo) - (hi - ohi)) < 1e-6 ? lo - olo : 0;
    const L0 = sideLine(ov, dr.side), L0t = [L0.b[0] - L0.a[0], L0.b[1] - L0.a[1]], L0len = Math.hypot(L0t[0], L0t[1]);
    const at = (alongX ? L0.a[0] + L0t[0] / L0len * dr.t : L0.a[1] + L0t[1] / L0len * dr.t) + shift;
    const c = Math.min(hi - 0.5, Math.max(lo + 0.5, at));
    const L = sideLine(v, dr.side);
    updated.push(alongX
      ? { ...n, x: c, z: L.a[1] + L.n[1] * dr.d, y: base + Math.min(v.floors - 1, dr.floor) * FLOOR_H }
      : { ...n, z: c, x: L.a[0] + L.n[0] * dr.d, y: base + Math.min(v.floors - 1, dr.floor) * FLOOR_H });
  }
  return updated;
}
