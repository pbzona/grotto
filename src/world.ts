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
export interface Prop { id: string; type: PropType; x: number; z: number; rot: number; seed: number; scale?: number }
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
  paint = new Uint8Array(N * N * 4);
  houses = new Map<string, House>();
  nodes = new Map<string, WalkNode>();
  edges = new Map<string, WalkEdge>();
  props = new Map<string, Prop>();
  version = 0;

  level(x: number, z: number) {
    x = Math.max(0, Math.min(N - 1, x | 0)); z = Math.max(0, Math.min(N - 1, z | 0));
    return this.heights[z * N + x];
  }
  setLevel(x: number, z: number, l: number) {
    if (x < 0 || z < 0 || x >= N || z >= N) return;
    this.heights[z * N + x] = Math.max(0, Math.min(MAX_LEVEL, Math.round(l)));
  }

  /** Smooth (cubic B-spline) level field: organic contours instead of square cells. */
  field(x: number, z: number) {
    const fx = x - 0.5, fz = z - 0.5;
    const i0 = Math.floor(fx), j0 = Math.floor(fz);
    const tx = fx - i0, tz = fz - j0;
    const bx = bspline(tx), bz = bspline(tz);
    let L = 0;
    for (let b = 0; b < 4; b++) {
      let row = 0;
      for (let a = 0; a < 4; a++) row += bx[a] * this.level(i0 - 1 + a, j0 - 1 + b);
      L += row * bz[b];
    }
    return L;
  }
  /** Continuous surface: flat terraces joined by steep risers, so cliffs read as stepped sandstone strata. */
  height(x: number, z: number) {
    const L = this.field(x, z);
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
    return true;
  }

  clear() {
    this.houses.clear(); this.nodes.clear(); this.edges.clear(); this.props.clear();
    this.paint.fill(0); this.version++;
  }

  // ---------- serialisation ----------
  save() {
    return {
      v: 1, n: N,
      heights: b64(this.heights), paint: b64(this.paint),
      houses: [...this.houses.values()], nodes: [...this.nodes.values()], edges: [...this.edges.values()], props: [...this.props.values()],
    };
  }
  load(s: any) {
    if (!s || s.n !== N) throw new Error("incompatible save");
    this.heights.set(unb64(s.heights)); this.paint.set(unb64(s.paint));
    this.houses = new Map((s.houses ?? []).map((h: House) => [h.id, h]));
    this.nodes = new Map((s.nodes ?? []).map((n: WalkNode) => [n.id, n]));
    this.edges = new Map((s.edges ?? []).map((e: WalkEdge) => [e.id, e]));
    this.props = new Map((s.props ?? []).map((p: Prop) => [p.id, p]));
    this.version++;
  }
}

function b64(a: Uint8Array) { let s = ""; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
function unb64(s: string) { const b = atob(s); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }

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
