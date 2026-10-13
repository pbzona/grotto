// Water routes. A sloop belonging to the village berths at a pier head overnight, sails off the map
// in the morning and comes back in the late afternoon; the smugglers' rowboat comes in from the open
// sea at night. Both are derived from the world and the hour dial: nothing is saved, and scrubbing
// the dial slides them along their routes. Routes run on a half-unit water grid that keeps each hull
// clear of land, shallows, houses, posts, landmarks and moored boats. Rowboats may slip under
// walkways with real headroom; sloops never go under a deck. Placed boats are plain props and stay put.
import { World, N, WATER_Y, isLandmark, landmarkSamples, quaySamples, grottoDims, type Prop } from "./world.ts";

const RES = 2;                 // grid cells per unit
const G = N * RES;
type Pt = [number, number];

interface Kind { draft: number; radius: number; speed: number; halfLen: number; beam: number }
const ROW: Kind = { draft: 0.15, radius: 0.45, speed: 5, halfLen: 0.95, beam: 0.4 };
const SLOOP: Kind = { draft: 0.5, radius: 0.8, speed: 8, halfLen: 1.9, beam: 0.68 };
/** Clearance a rowboat needs under a deck, and the height where tall decks start carrying X bracing. */
export const UNDER_DECK = 1.0, BRACED = 1.2;

const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const isBoat = (p: Prop) => p.type === "rowboat" || p.type === "sloop";

/** Grid of free cells for one hull, plus each cell's distance (units) to the nearest obstacle. */
export interface NavGrid { free: Uint8Array; clear: Float32Array; kind: Kind }
const cx = (i: number) => (i + 0.5) / RES;

export function navGrid(world: World, big: boolean, skip?: string): NavGrid {
  const kind = big ? SLOOP : ROW;
  const blocked = new Uint8Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = cx(i), z = cx(j);
    if (world.height(x, z) >= WATER_Y - kind.draft || world.houseAt(x, z, 0.15)) blocked[j * G + i] = 1;
  }
  const disc = (x: number, z: number, r: number) => {
    const i0 = Math.max(0, Math.floor((x - r) * RES)), i1 = Math.min(G - 1, Math.floor((x + r) * RES));
    const j0 = Math.max(0, Math.floor((z - r) * RES)), j1 = Math.min(G - 1, Math.floor((z + r) * RES));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (Math.hypot(cx(i) - x, cx(j) - z) <= r) blocked[j * G + i] = 1;
  };
  const capsule = (ax: number, az: number, bx: number, bz: number, r: number) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 0.25));
    for (let k = 0; k <= n; k++) disc(ax + (bx - ax) * k / n, az + (bz - az) * k / n, r);
  };
  for (const e of world.edges.values()) {
    const a = world.nodes.get(e.a), b = world.nodes.get(e.b);
    if (!a || !b) continue;
    if (!big && passable(e.style, Math.min(a.y, b.y))) continue;
    capsule(a.x, a.z, b.x, b.z, e.width / 2 + 0.1);
  }
  for (const n of world.nodes.values()) {
    if (n.pad > 0) disc(n.x, n.z, n.pad * 1.42);
    else if (world.edgesOf(n.id).length) disc(n.x, n.z, 0.85);
  }
  for (const p of world.props.values()) {
    if (isLandmark(p.type)) {
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      const lim = p.type === "grotto" ? 1 : Infinity;   // the water kept open in front of a grotto stays sailable
      for (const [x, z] of landmarkSamples(p)) {
        const lz = -(x - p.x) * s + (z - p.z) * c;
        if (lz <= lim) disc(x, z, p.type === "grotto" ? Math.min(0.6, grottoDims(p).T) : 0.55);
      }
      if (p.type === "grotto") for (const [x, z] of quaySamples(p)) disc(x, z, 0.45);
    } else if (isBoat(p) && p.id !== skip) {
      const k = p.type === "sloop" ? SLOOP : ROW, fx = -Math.sin(p.rot) * k.halfLen, fz = Math.cos(p.rot) * k.halfLen;
      capsule(p.x - fx, p.z - fz, p.x + fx, p.z + fz, k.beam);
    }
  }
  // distance to the nearest obstacle; the open sea past the map edge counts as clear
  const INF = 1e9, d = new Float32Array(G * G);
  for (let k = 0; k < G * G; k++) d[k] = blocked[k] ? 0 : INF;
  const D = Math.SQRT2;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const k = j * G + i; let v = d[k];
    if (i > 0) v = Math.min(v, d[k - 1] + 1);
    if (j > 0) { v = Math.min(v, d[k - G] + 1); if (i > 0) v = Math.min(v, d[k - G - 1] + D); if (i < G - 1) v = Math.min(v, d[k - G + 1] + D); }
    d[k] = v;
  }
  for (let j = G - 1; j >= 0; j--) for (let i = G - 1; i >= 0; i--) {
    const k = j * G + i; let v = d[k];
    if (i < G - 1) v = Math.min(v, d[k + 1] + 1);
    if (j < G - 1) { v = Math.min(v, d[k + G] + 1); if (i < G - 1) v = Math.min(v, d[k + G + 1] + D); if (i > 0) v = Math.min(v, d[k + G - 1] + D); }
    d[k] = v;
  }
  const free = new Uint8Array(G * G), clear = new Float32Array(G * G);
  for (let k = 0; k < G * G; k++) { clear[k] = Math.min(20, d[k] / RES); free[k] = clear[k] > kind.radius ? 1 : 0; }
  return { free, clear, kind };
}

/** Can a rowboat pass under this walkway? Needs headroom, and tall decks carry X bracing between posts. */
export function passable(style: string, deckY: number) {
  const c = deckY - WATER_Y - (style === "rope" ? 0.35 : 0);
  return c >= UNDER_DECK && (style === "rope" || c <= BRACED);
}

const cellOf = (x: number, z: number) => {
  const i = Math.floor(x * RES), j = Math.floor(z * RES);
  return i < 0 || j < 0 || i >= G || j >= G ? -1 : j * G + i;
};
export function isFree(g: NavGrid, x: number, z: number) { const k = cellOf(x, z); return k >= 0 && g.free[k] === 1; }
function sight(g: NavGrid, a: Pt, b: Pt) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 0.2));
  for (let k = 0; k <= n; k++) if (!isFree(g, a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n)) return false;
  return true;
}

/** Shortest water distances from a cell (8-way, no corner cutting). */
function flood(g: NavGrid, start: number) {
  const dist = new Float32Array(G * G).fill(Infinity), prev = new Int32Array(G * G).fill(-1);
  dist[start] = 0;
  const heap: number[] = [start];
  const less = (a: number, b: number) => dist[heap[a]] < dist[heap[b]];
  const swap = (a: number, b: number) => { const t = heap[a]; heap[a] = heap[b]; heap[b] = t; };
  const push = (k: number) => { heap.push(k); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!less(i, p)) break; swap(i, p); i = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && less(l, m)) m = l; if (r < heap.length && less(r, m)) m = r; if (m === i) break; swap(i, m); i = m; } }
    return top;
  };
  const done = new Uint8Array(G * G);
  while (heap.length) {
    const k = pop();
    if (done[k]) continue; done[k] = 1;
    const i = k % G, j = (k - i) / G;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= G || nj >= G) continue;
      const nk = nj * G + ni;
      if (!g.free[nk] || done[nk]) continue;
      if (di && dj && (!g.free[j * G + ni] || !g.free[nj * G + i])) continue;
      const nd = dist[k] + (di && dj ? Math.SQRT2 : 1) / RES;
      if (nd < dist[nk]) { dist[nk] = nd; prev[nk] = k; push(nk); }
    }
  }
  return { dist, prev };
}

/** Pull a grid path taut, then round its corners where the rounded line still has water. */
function tidy(g: NavGrid, pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0], pts[1]];
  let i = 1;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !sight(g, pts[i], pts[j])) j--;
    out.push(pts[j]); i = j;
  }
  let p = out;
  for (let it = 0; it < 2; it++) {
    const q: Pt[] = [p[0], p[1]];
    for (let k = 1; k < p.length - 1; k++) {
      const a = p[k], b = p[k + 1];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    q.push(p[p.length - 1]);
    let ok = true;
    for (let k = 1; k < q.length - 1 && ok; k++) ok = sight(g, q[k], q[k + 1]);
    if (!ok) break;
    p = q;
  }
  return p;
}

/**
 * Shortest water route in from the open sea (any map edge) to a berth at (x, z), pulled taut.
 * `extra` points are appended after the berth (e.g. into a grotto's vault). With `exact` false the
 * route stops at the open water nearest the berth instead of at it (alongside a pier head).
 */
export function seaRoute(world: World, big: boolean, x: number, z: number, extra: Pt[] = [], reach = 2.5, exact = true): Pt[] | null {
  const g = navGrid(world, big);
  let start = -1, best = Infinity;
  for (let j = Math.floor((z - reach) * RES); j <= Math.ceil((z + reach) * RES); j++) for (let i = Math.floor((x - reach) * RES); i <= Math.ceil((x + reach) * RES); i++) {
    if (i < 0 || j < 0 || i >= G || j >= G || !g.free[j * G + i]) continue;
    const d = Math.hypot(cx(i) - x, cx(j) - z);
    if (d < best && d <= reach) { best = d; start = j * G + i; }
  }
  if (start < 0) return null;
  const { dist, prev } = flood(g, start);
  let exit = -1, far = Infinity;
  for (let k = 0; k < G; k++) for (const c of [k, (G - 1) * G + k, k * G, k * G + G - 1]) if (dist[c] < far) { far = dist[c]; exit = c; }
  if (exit < 0) return null;
  const cells: Pt[] = [];
  for (let c = exit; c >= 0; c = prev[c]) cells.push([cx(c % G), cx(Math.floor(c / G))]);
  // start just past the map edge so the boat sails in rather than appearing on it
  const e = cells[0], out: Pt = [e[0] < 1 ? -1.5 : e[0] > N - 1 ? N + 1.5 : e[0], e[1] < 1 ? -1.5 : e[1] > N - 1 ? N + 1.5 : e[1]];
  const path = tidy(g, cells);
  const end = path[path.length - 1];
  const tail: Pt[] = exact && Math.hypot(end[0] - x, end[1] - z) > 0.05 ? [[x, z]] : [];
  return [out, ...path, ...tail, ...extra];
}

export interface SloopPlan {
  pad: string;
  berth: { x: number; z: number; rot: number };
  /** From beyond the map edge to the berth. */
  path: Pt[]; cum: number[]; length: number;
  travel: number; depart: number; back: number;
}
export interface SloopPose { x: number; z: number; rot: number; vis: number; moving: boolean }

const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
};

/**
 * The village sloop: lies alongside a pier head (a low pad over deep water), lying along the pad's
 * side, clear of every deck and boat; null when no pier head has room or no way out to sea.
 */
export function planSloop(world: World): SloopPlan | null {
  const pads = [...world.nodes.values()]
    .filter(n => n.pad > 0 && world.edgesOf(n.id).length && n.y < 1.6 && world.height(n.x, n.z) < WATER_Y - 0.4)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const n of pads) {
    let best: { x: number; z: number; rot: number } | null = null, deep = Infinity;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2, ox = Math.round(Math.cos(a)), oz = Math.round(Math.sin(a));
      for (const slide of [0, 0.6, -0.6]) {
        const r = n.pad / 2 + 0.95, bx = n.x + ox * r - oz * slide, bz = n.z + oz * r + ox * slide;
        const fx = -oz, fz = ox;   // along the pad's side
        const ends: Pt[] = [[bx - fx * 1.9, bz - fz * 1.9], [bx, bz], [bx + fx * 1.9, bz + fz * 1.9]];
        if (ends.some(([x, z]) => x < 0.5 || z < 0.5 || x > N - 0.5 || z > N - 0.5 || world.height(x, z) > WATER_Y - 0.6 || world.houseAt(x, z, 0.5))) continue;
        let ok = true;
        for (const e of world.edges.values()) {
          const A = world.nodes.get(e.a), B = world.nodes.get(e.b);
          if (A && B && ends.some(([x, z]) => segDist(x, z, A.x, A.z, B.x, B.z) < e.width / 2 + 0.6)) { ok = false; break; }
        }
        for (const o of world.nodes.values()) if (o.pad > 0 && o.id !== n.id && ends.some(([x, z]) => Math.abs(x - o.x) < o.pad / 2 + 0.6 && Math.abs(z - o.z) < o.pad / 2 + 0.6)) ok = false;
        for (const p of world.props.values()) {
          if (isBoat(p) && ends.some(([x, z]) => Math.hypot(p.x - x, p.z - z) < (p.type === "sloop" ? 2 : 1.3))) ok = false;
          else if (isLandmark(p.type) && landmarkSamples(p).some(([sx, sz]) => ends.some(([x, z]) => Math.hypot(sx - x, sz - z) < 1))) ok = false;
        }
        const h = world.height(bx, bz);
        if (ok && h < deep - 0.05) { deep = h; best = { x: bx, z: bz, rot: Math.atan2(-fx, fz) }; }
      }
    }
    if (!best) continue;
    const path = seaRoute(world, true, best.x, best.z, [], 2);
    if (!path) continue;
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    const length = cum[cum.length - 1], r1 = hash(n.x * 7.1 + n.z * 3.3), r2 = hash(n.x * 1.7 + n.z * 9.1 + 4);
    return { pad: n.id, berth: best, path, cum, length, travel: Math.max(0.6, Math.min(2.2, length / 8)), depart: 6.4 + r1, back: 16.3 + r2 };
  }
  return null;
}

function along(p: SloopPlan, s: number): Pt {
  const P = p.path, C = p.cum;
  s = Math.max(0, Math.min(p.length, s));
  let i = 1; while (i < C.length - 1 && C[i] < s) i++;
  const t = (s - C[i - 1]) / Math.max(1e-6, C[i] - C[i - 1]);
  return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t];
}

/** Where the sloop is at this hour: at the berth overnight, gone past the map edge by day. */
export function sloopAt(p: SloopPlan, hour: number): SloopPose {
  const home: SloopPose = { ...p.berth, vis: 1, moving: false };
  const t1 = p.depart, t2 = t1 + p.travel, t3 = p.back, t4 = t3 + p.travel;
  if (hour < t1 || hour >= t4) return home;
  if (hour >= t2 && hour < t3) return { ...p.berth, vis: 0, moving: false };
  // s: distance from the map edge along the route in
  const out = hour < t2, s = out ? (1 - ease((hour - t1) / p.travel)) * p.length : ease((hour - t3) / p.travel) * p.length;
  const [x, z] = along(p, s), a = along(p, s - 0.7), b = along(p, s + 0.7);
  const dir = out ? -1 : 1, head = rotOf((b[0] - a[0]) * dir, (b[1] - a[1]) * dir);
  // swing off (or onto) the berth heading over the last stretch; shrink away out past the edge
  const rot = turn(p.berth.rot, head, sstep((p.length - s) / 2.5));
  return { x, z, rot, vis: sstep(s / 2), moving: true };
}

const rotOf = (dx: number, dz: number) => Math.atan2(-dx, dz);
const turn = (a: number, b: number, t: number) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
const ease = (t: number) => t - Math.sin(t * Math.PI * 2) / (Math.PI * 2);
const sstep = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
