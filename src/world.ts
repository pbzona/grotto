// World model for Grotto: a terraced cove heightfield, painted surface, parametric houses,
// a walkway graph (docks, piers, boardwalks, stairs, rope bridges) and free-placed props.

export const N = 48;               // the cove is N x N cells (1 unit each)
export const STEP = 0.5;           // height of one terrace level
export const BASE_Y = -2.5;        // world y of level 0 (deep seabed)
export const MAX_LEVEL = 24;
export const WATER_Y = 0.2;        // sea surface
export const FLOOR_H = 1.15;       // storey height
export const PLINTH = 0.18;
export const DECK_Y = WATER_Y + 0.75; // default deck height over water (houses on stilts share it)
export const SNAP = 0.5;
export const snap = (v: number) => Math.round(v / SNAP) * SNAP;
export const levelY = (l: number) => BASE_Y + l * STEP;

export type PaintType = "path" | "cobble" | "greenery" | "sand";
export const PAINT_CH: Record<PaintType, number> = { path: 0, cobble: 1, greenery: 2, sand: 3 };

// ---------- houses ----------
export type RoofType = "gable" | "hip" | "flat" | "shed";
export type WallStyle = "plaster" | "plank" | "stone";
export type VolumeKind = "room" | "tower" | "lookout";
export interface Volume {
  x0: number; z0: number; x1: number; z1: number;
  floors: number;
  roof: RoofType;
  ridgeX: boolean | null;   // null = along the longer side
  pitch: number;            // 0.5..1.6
  curve: number;            // -1..1 roof belly/sag
  overhang: number;         // 0.05..0.45
  kind?: VolumeKind;
  /** Player overrides for wall bays keyed `side:floor:slot`. */
  openings?: Record<string, "window" | "wall" | "door">;
}
export type Foundation = "auto" | "stilts" | "keyed" | "rock";
export interface House {
  id: string; seed: number; palette: number; style: WallStyle; volumes: Volume[];
  foundation: Foundation;
  shutters: boolean; boxes: boolean; awning: boolean;
}
export const newVolume = (x0: number, z0: number, x1: number, z1: number, floors = 1, roof: RoofType = "gable"): Volume =>
  ({ x0, z0, x1, z1, floors, roof, ridgeX: null, pitch: 1, curve: 0.3, overhang: 0.22 });

// ---------- walkway graph ----------
export interface WalkNode {
  id: string; x: number; z: number;
  /** deck height (world y) */
  y: number;
  /** a square landing around the node (half size); 0 = none */
  pad: number;
}
export type WalkStyle = "deck" | "rope";
export interface WalkEdge { id: string; a: string; b: string; width: number; style: WalkStyle; rail: boolean }

// ---------- props ----------
export type PropType =
  | "palm" | "bougainvillea" | "scrub" | "rock" | "barrels" | "crates" | "lantern" | "nets" | "laundry"
  | "rowboat" | "sloop" | "hull" | "grotto" | "lighthouse" | "crane";
export interface Prop {
  id: string; type: PropType; x: number; z: number; rot: number; seed: number; scale?: number;
  /** variant choices for landmarks (unset keys fall back to a seeded pick) */
  opts?: Record<string, string | number>;
  /** Derived cells capped by a grotto, with current base levels (not serialized in v2). */
  carved?: [number, number, number][];
}
const optHash = (seed: number, k: string) => { let h = (Math.floor(seed * 1e6) ^ 0x9e3779b9) >>> 0; for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619) >>> 0; return (h % 10007) / 10007; };
export function propOpt<T extends string | number>(p: Pick<Prop, "seed" | "opts">, key: string, choices: readonly T[]): T {
  const v = p.opts?.[key];
  if (v !== undefined && (choices as readonly (string | number)[]).includes(v)) return v as T;
  return choices[Math.floor(optHash(p.seed, key) * choices.length)];
}
export const HULL_OPTS = { size: [0, 1, 2], cabin: ["low", "tall", "stern"], roof: ["gable", "hip", "awning"], masts: [0, 1, 2], annex: ["none", "deck", "shack"] } as const;
export const GROTTO_OPTS = { size: [0, 1, 2], arch: ["round", "tall", "wide"], dock: ["left", "right", "both"] } as const;
export function hullDims(p: Pick<Prop, "seed" | "opts">) { const s = propOpt(p, "size", HULL_OPTS.size); return { len: [6.6, 8, 9.4][s], wid: [2.7, 3.2, 3.6][s], dep: [1.4, 1.7, 1.9][s] }; }
export function grottoDims(p: Pick<Prop, "seed" | "opts">) { const s = propOpt(p, "size", GROTTO_OPTS.size); return { R: [2.2, 2.7, 3.2][s], D: [3.8, 4.6, 5.4][s], T: 1.1 }; }
/** Flooded channel and lowered lip; these caps never overwrite editable base terrain. */
export function grottoCells(p: Prop): { i: number; j: number; cap: number; under: boolean }[] {
  const { R, D, T } = grottoDims(p);
  const c = Math.cos(p.rot), s = Math.sin(p.rot), out: { i: number; j: number; cap: number; under: boolean }[] = [];
  const lip = Math.round((R * 0.95 - 0.8 + T + 0.2 - levelY(0)) / STEP);
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
/** Ground points a landmark covers (world x,z), for collision and placement checks. */
export function landmarkSamples(p: Prop): [number, number][] {
  const c = Math.cos(p.rot), s = Math.sin(p.rot), out: [number, number][] = [];
  const add = (lx: number, lz: number) => out.push([p.x + lx * c - lz * s, p.z + lx * s + lz * c]);
  if (p.type === "hull") {
    const { len, wid } = hullDims(p);
    for (let lz = -len / 2; lz <= len / 2 + 1e-6; lz += 0.7) {
      const t = (2 * lz) / len, hw = (wid / 2) * Math.sqrt(Math.max(0.05, 1 - t * t));
      for (let lx = -hw; lx <= hw + 1e-6; lx += 0.7) add(lx, lz);
      add(-hw, lz); add(hw, lz);
    }
    if (propOpt(p, "annex", HULL_OPTS.annex) !== "none") for (let lx = -wid / 2 - 2.4; lx < -wid / 2; lx += 0.6) for (let lz = -1.2; lz <= 1.8; lz += 0.6) add(lx, lz);
  } else if (p.type === "grotto") {
    const { R, D, T } = grottoDims(p);
    for (let lx = -R - T; lx <= R + T + 1e-6; lx += 0.7) for (let lz = -D - 0.3; lz <= 0.8; lz += 0.7) add(lx, lz);
    // open water kept clear in front of the mouth
    for (let lx = -R - 0.6; lx <= R + 0.6 + 1e-6; lx += 0.7) for (let lz = 1.5; lz <= 5; lz += 0.7) add(lx, lz);
  } else if (p.type === "lighthouse") {
    add(0, 0); for (let k = 0; k < 10; k++) add(Math.cos(k * 0.628) * 1.15, Math.sin(k * 0.628) * 1.15);
  } else add(0, 0);
  return out;
}
export const isLandmark = (t: PropType) => t === "hull" || t === "grotto" || t === "lighthouse";
export const WATER_PROPS: PropType[] = ["rowboat", "sloop"];

let _id = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36)}${(_id++).toString(36)}`;

const hash2 = (x: number, z: number) => { const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return v - Math.floor(v); };
function vnoise(x: number, z: number) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return (a * (1 - s(fx)) + b * s(fx)) * (1 - s(fz)) + (c * (1 - s(fx)) + d * s(fx)) * s(fz);
}
export const fbm = (x: number, z: number) => vnoise(x, z) * 0.55 + vnoise(x * 2.1 + 7, z * 2.1 + 3) * 0.3 + vnoise(x * 4.3 + 1, z * 4.3 + 9) * 0.15;

const _bs = [0, 0, 0, 0];
function bspline(t: number) {
  const t2 = t * t, t3 = t2 * t, u = 1 - t;
  _bs[0] = u * u * u / 6; _bs[1] = (3 * t3 - 6 * t2 + 4) / 6; _bs[2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6; _bs[3] = t3 / 6;
  return [_bs[0], _bs[1], _bs[2], _bs[3]];
}
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class World {
  heights = new Uint8Array(N * N);
  private carveCaps = new Uint8Array(N * N).fill(MAX_LEVEL);
  paint = new Uint8Array(N * N * 4);
  houses = new Map<string, House>();
  nodes = new Map<string, WalkNode>();
  edges = new Map<string, WalkEdge>();
  props = new Map<string, Prop>();
  version = 0;

  level(x: number, z: number) {
    x = Math.max(0, Math.min(N - 1, x | 0)); z = Math.max(0, Math.min(N - 1, z | 0));
    return Math.min(this.heights[z * N + x], this.carveCaps[z * N + x]);
  }
  baseLevel(x: number, z: number) { x = Math.max(0, Math.min(N - 1, x | 0)); z = Math.max(0, Math.min(N - 1, z | 0)); return this.heights[z * N + x]; }
  rebuildCarving() {
    this.carveCaps.fill(MAX_LEVEL);
    for (const p of this.props.values()) {
      if (p.type !== "grotto") continue;
      p.carved = [];
      for (const { i, j, cap } of grottoCells(p)) {
        const k = j * N + i;
        this.carveCaps[k] = Math.min(this.carveCaps[k], cap);
        if (this.heights[k] > cap) p.carved.push([i, j, this.heights[k]]);
      }
    }
  }
  setLevel(x: number, z: number, l: number) {
    if (x < 0 || z < 0 || x >= N || z >= N) return;
    this.heights[z * N + x] = Math.max(0, Math.min(MAX_LEVEL, Math.round(l)));
  }

  /** Smooth (cubic B-spline) level field: organic contours instead of square cells. */
  field(x: number, z: number, baseTerrain = false) {
    const fx = x - 0.5, fz = z - 0.5;
    const i0 = Math.floor(fx), j0 = Math.floor(fz);
    const tx = fx - i0, tz = fz - j0;
    const bx = bspline(tx), bz = bspline(tz);
    let L = 0;
    for (let b = 0; b < 4; b++) {
      let row = 0;
      for (let a = 0; a < 4; a++) row += bx[a] * (baseTerrain ? this.baseLevel(i0 - 1 + a, j0 - 1 + b) : this.level(i0 - 1 + a, j0 - 1 + b));
      L += row * bz[b];
    }
    return L;
  }
  /** Continuous surface: flat terraces joined by steep risers, so cliffs read as stepped sandstone strata. */
  height(x: number, z: number, baseTerrain = false) {
    const L = this.field(x, z, baseTerrain);
    const base = Math.floor(L + 1e-6);
    return levelY(base + sstep(0.3, 0.7, L - base));
  }
  isWater(x: number, z: number) { return this.height(x, z) < WATER_Y - 0.02; }

  paintAt(x: number, z: number, ch: number) {
    const i = Math.floor(x), j = Math.floor(z);
    if (i < 0 || j < 0 || i >= N || j >= N) return 0;
    return this.paint[(j * N + i) * 4 + ch] / 255;
  }

  // ---------- walkway helpers ----------
  edgesOf(nodeId: string) { const out: WalkEdge[] = []; for (const e of this.edges.values()) if (e.a === nodeId || e.b === nodeId) out.push(e); return out; }
  splitEdge(id: string, node: WalkNode): [WalkEdge, WalkEdge] {
    const e = this.edges.get(id);
    if (!e || !this.nodes.has(e.a) || !this.nodes.has(e.b) || !this.nodes.has(node.id) || node.id === e.a || node.id === e.b) throw new Error("Invalid edge split");
    const a = { ...e, id: uid("e"), b: node.id }, b = { ...e, id: uid("e"), a: node.id };
    this.edges.delete(id); this.edges.set(a.id, a); this.edges.set(b.id, b);
    return [a, b];
  }
  removeNode(id: string) {
    for (const e of this.edgesOf(id)) this.edges.delete(e.id);
    this.nodes.delete(id);
  }
  /** drop nodes with no edges and no landing */
  pruneNodes() { for (const n of [...this.nodes.values()]) if (!this.edgesOf(n.id).length && n.pad <= 0) this.nodes.delete(n.id); }

  houseAt(px: number, pz: number, margin = 0): House | undefined {
    for (const h of this.houses.values()) for (const v of h.volumes)
      if (px > v.x0 - margin && px < v.x1 + margin && pz > v.z0 - margin && pz < v.z1 + margin) return h;
    return undefined;
  }
  footprintFree(x0: number, z0: number, x1: number, z1: number, except?: House, minSize = 1) {
    if (x0 < 0.5 || z0 < 0.5 || x1 > N - 0.5 || z1 > N - 0.5 || x1 - x0 < minSize || z1 - z0 < minSize) return false;
    for (const h of this.houses.values()) {
      if (h === except) continue;
      for (const v of h.volumes) if (x0 < v.x1 - 0.01 && x1 > v.x0 + 0.01 && z0 < v.z1 - 0.01 && z1 > v.z0 + 0.01) return false;
    }
    for (const p of this.props.values()) if (isLandmark(p.type))
      for (const [x, z] of landmarkSamples(p)) if (x > x0 - 0.25 && x < x1 + 0.25 && z > z0 - 0.25 && z < z1 + 0.25) return false;
    return true;
  }

  clear() {
    this.houses.clear(); this.nodes.clear(); this.edges.clear(); this.props.clear();
    this.carveCaps.fill(MAX_LEVEL); this.paint.fill(0); this.version++;
  }

  // ---------- serialisation ----------
  save() {
    return {
      v: 2, n: N,
      heights: b64(this.heights), paint: b64(this.paint),
      houses: [...this.houses.values()], nodes: [...this.nodes.values()], edges: [...this.edges.values()], props: [...this.props.values()].map(({ carved, ...p }) => p),
    };
  }
  load(input: unknown) {
    const s = decodeWorld(input);
    this.heights.set(s.heights); this.paint.set(s.paint);
    this.houses = s.houses; this.nodes = s.nodes; this.edges = s.edges; this.props = s.props;
    this.rebuildCarving();
    this.version++;
  }
}

function b64(a: Uint8Array) { let s = ""; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
function unb64(s: string) { const b = atob(s); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }

type RecordData = Record<string, unknown>;
function requireSave(ok: unknown): asserts ok { if (!ok) throw new Error("Invalid Grotto save"); }
function record(v: unknown): RecordData { requireSave(v && typeof v === "object" && !Array.isArray(v)); return v as RecordData; }
function num(v: unknown, min = -10000, max = 10000): asserts v is number { requireSave(typeof v === "number" && Number.isFinite(v) && v >= min && v <= max); }
function integer(v: unknown, min: number, max: number) { num(v, min, max); requireSave(Number.isInteger(v)); }
function choice(v: unknown, choices: readonly unknown[]) { requireSave(choices.includes(v)); }
function bool(v: unknown) { requireSave(typeof v === "boolean"); }
function text(v: unknown): asserts v is string { requireSave(typeof v === "string" && v.length > 0 && v.length <= 256); }
function entries<T extends { id: string }>(v: unknown, validate: (r: RecordData) => void): Map<string, T> {
  requireSave(Array.isArray(v) && v.length <= 10000);
  const out = new Map<string, T>();
  for (const item of v) { const r = record(item); text(r.id); requireSave(!out.has(r.id)); validate(r); out.set(r.id, structuredClone(r) as unknown as T); }
  return out;
}

/** Validate the entire payload before touching the live world. */
function decodeWorld(input: unknown) {
  const s = record(input);
  requireSave((s.v === 1 || s.v === 2) && s.n === N);
  return decodeWorldData(s);
}
function decodeWorldData(s: RecordData) {
  requireSave(typeof s.heights === "string" && typeof s.paint === "string");
  requireSave(s.heights.length === Math.ceil(N * N / 3) * 4 && s.paint.length === Math.ceil(N * N * 4 / 3) * 4);
  const heights = unb64(s.heights), paint = unb64(s.paint);
  requireSave(heights.length === N * N && paint.length === N * N * 4 && heights.every(l => l <= MAX_LEVEL));
  const houses = entries<House>(s.houses, h => {
    num(h.seed); integer(h.palette, 0, 7); choice(h.style, ["plaster", "plank", "stone"]); choice(h.foundation, ["auto", "stilts", "keyed", "rock"]);
    bool(h.shutters); bool(h.boxes); bool(h.awning);
    requireSave(Array.isArray(h.volumes) && h.volumes.length > 0 && h.volumes.length <= 128);
    for (const item of h.volumes) {
      const v = record(item);
      for (const k of ["x0", "z0", "x1", "z1"]) num(v[k], 0, N);
      requireSave((v.x1 as number) > (v.x0 as number) && (v.z1 as number) > (v.z0 as number));
      integer(v.floors, 1, 4); choice(v.roof, ["gable", "hip", "flat", "shed"]); choice(v.ridgeX, [null, true, false]);
      num(v.pitch, 0.5, 1.6); num(v.curve, -1, 1); num(v.overhang, 0.05, 0.45);
      if (v.kind !== undefined) choice(v.kind, ["room", "tower", "lookout"]);
      if (v.openings !== undefined) for (const [k, value] of Object.entries(record(v.openings))) { requireSave(/^\d+:\d+:\d+$/.test(k)); choice(value, ["window", "wall", "door"]); }
    }
  });
  // Wall docks can sit just beyond the grid when attached to an outermost house.
  const nodes = entries<WalkNode>(s.nodes, n => { num(n.x, -1, N + 1); num(n.z, -1, N + 1); num(n.y, -3, 20); num(n.pad, 0, 5); });
  const edges = entries<WalkEdge>(s.edges, e => {
    text(e.a); text(e.b); requireSave(e.a !== e.b && nodes.has(e.a) && nodes.has(e.b));
    num(e.width, 0.1, 5); choice(e.style, ["deck", "rope"]); bool(e.rail);
  });
  const props = entries<Prop>(s.props, p => {
    choice(p.type, ["palm", "bougainvillea", "scrub", "rock", "barrels", "crates", "lantern", "nets", "laundry", "rowboat", "sloop", "hull", "grotto", "lighthouse", "crane"]);
    num(p.x, 0, N); num(p.z, 0, N); num(p.rot); num(p.seed);
    if (p.scale !== undefined) num(p.scale, 0.1, 5);
    if (p.opts !== undefined) for (const [k, v] of Object.entries(record(p.opts))) { text(k); if (typeof v === "number") num(v); else text(v); }
    if (p.carved !== undefined) {
      requireSave(p.type === "grotto" && Array.isArray(p.carved) && p.carved.length <= N * N);
      const seen = new Set<number>();
      for (const cell of p.carved) { requireSave(Array.isArray(cell) && cell.length === 3); integer(cell[0], 0, N - 1); integer(cell[1], 0, N - 1); integer(cell[2], 0, MAX_LEVEL); const k = cell[1] * N + cell[0]; requireSave(!seen.has(k)); seen.add(k); }
    }
  });
  // v1 stored already-carved heights; recover the saved base before applying derived caps.
  if (s.v === 1) for (const p of props.values()) for (const [i, j, l] of p.carved ?? []) heights[j * N + i] = Math.max(heights[j * N + i], l);
  for (const p of props.values()) delete p.carved;
  return { heights, paint, houses, nodes, edges, props };
}

/** The sheltered cove: sandstone cliffs wrap a lagoon that opens to the sea on the south. */
export function carveCove(w: World) {
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N - 0.5, v = (j + 0.5) / N;
    const n = fbm(i * 0.13, j * 0.13), n2 = fbm(i * 0.31 + 11, j * 0.31 + 5);
    // lagoon: an ellipse pushed south, wobbly shoreline
    const r = Math.hypot(u * 1.75, (v - 0.64) * 1.45) + (n - 0.5) * 0.12;
    // the mouth: a channel through the southern rim
    const mouth = v > 0.72 && Math.abs(u + (n2 - 0.5) * 0.08) < 0.17 + (v - 0.72) * 0.9;
    let L: number;
    if (r < 0.46 || mouth) {
      const d = mouth ? Math.max(0, 1 - Math.abs(u) / 0.35) : 1 - r / 0.46;
      L = 5 - Math.round(Math.min(1, d * 1.6 + (v > 0.85 ? 0.6 : 0)) * 4.4 + n2 * 0.8); // shallows (5) to deep (0-1)
      if (v > 0.93) L = Math.min(L, 1);
    } else if (r < 0.52) L = 6;                               // beach
    else if (r < 0.6) L = 7 + Math.round(n2 * 2);              // low terraces
    else if (r < 0.66) L = 10 + Math.round(n * 3);             // mid ledges
    else L = 15 + Math.round(n * 5 + n2 * 2);                  // cliff tops
    // headlands drop into the open sea at the southern edge
    if (v > 0.9 && !mouth) { const t = (v - 0.9) / 0.1; L = Math.round(L * (1 - t * 0.35)); }
    w.setLevel(i, j, Math.max(0, Math.min(MAX_LEVEL, L)));
  }
  // a pair of sea stacks guarding the mouth
  for (const [x, z, l] of [[16, 43, 13], [31, 42, 11]] as const) for (let dz = -1; dz < 3; dz++) for (let dx = -1; dx < 3; dx++) { const edge = dx < 0 || dz < 0 || dx > 1 || dz > 1; w.setLevel(x + dx, z + dz, edge ? Math.max(w.level(x + dx, z + dz), l - 6) : l - (dx + dz) % 2); }
  // natural sand paint on the beach band
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (w.level(i, j) === 6) w.paint[(j * N + i) * 4 + 3] = 200;
  w.version++;
}
