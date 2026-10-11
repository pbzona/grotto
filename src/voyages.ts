// Boats put out in the morning and come home in the afternoon. Everything here is derived from the
// world and the hour dial: nothing is saved, and scrubbing the dial slides each boat along its route.
// Routes run on a half-unit water grid that keeps each hull clear of land, shallows, houses, posts,
// landmarks and the other moorings. Rowboats may slip under walkways with real headroom; sloops never
// go under a deck. A boat with no way out stays moored.
import { World, N, WATER_Y, isLandmark, landmarkSamples, grottoDims, type Prop } from "./world.ts";

const RES = 2;                 // grid cells per unit
const G = N * RES;
type Pt = [number, number];

interface Kind { draft: number; radius: number; speed: number; halfLen: number; beam: number }
const ROW: Kind = { draft: 0.15, radius: 0.45, speed: 5, halfLen: 0.95, beam: 0.4 };
const SLOOP: Kind = { draft: 0.5, radius: 0.8, speed: 8, halfLen: 1.9, beam: 0.68 };
/** Clearance a rowboat needs under a deck, and the height where tall decks start carrying X bracing. */
export const UNDER_DECK = 1.0, BRACED = 1.2;
/** Every boat is back on its mooring by this hour. */
export const HOME_BY = 19.5;

export interface Voyage {
  id: string; big: boolean;
  home: { x: number; z: number; rot: number };
  /** Route from the mooring to the fishing spot (null: no way out, the boat stays home). */
  path: Pt[] | null;
  cum: number[]; length: number;
  depart: number; back: number; travel: number;
}

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

/** Plan every boat's day. Spots are kept apart; a boat that cannot get out has no path. */
export function planVoyages(world: World): Map<string, Voyage> {
  const out = new Map<string, Voyage>();
  const boats = [...world.props.values()].filter(isBoat).sort((a, b) => a.id < b.id ? -1 : 1);
  const spots: Pt[] = [];
  for (const p of boats) {
    const big = p.type === "sloop", g = navGrid(world, big, p.id), k = g.kind;
    const r1 = hash(p.seed * 91.7 + 1), r2 = hash(p.seed * 37.3 + 2), r3 = hash(p.seed * 13.1 + 3);
    const depart = big ? 7 + r1 * 1.5 : 6 + r1 * 2.2, back = big ? 15.8 + r2 * 1.6 : 15.2 + r2 * 2;
    const v: Voyage = { id: p.id, big, home: { x: p.x, z: p.z, rot: p.rot }, path: null, cum: [0], length: 0, depart, back, travel: 0 };
    out.set(p.id, v);
    // nearest open cell to the mooring; the hull already sits there, so the first leg is straight
    let start = -1, best = Infinity;
    for (let j = Math.floor((p.z - 2.5) * RES); j <= Math.ceil((p.z + 2.5) * RES); j++) for (let i = Math.floor((p.x - 2.5) * RES); i <= Math.ceil((p.x + 2.5) * RES); i++) {
      if (i < 0 || j < 0 || i >= G || j >= G || !g.free[j * G + i]) continue;
      const d = Math.hypot(cx(i) - p.x, cx(j) - p.z);
      if (d < best && d <= 2.5) { best = d; start = j * G + i; }
    }
    if (start < 0) continue;
    const { dist, prev } = flood(g, start);
    // out and back inside daylight: each leg fits before the turn of the day and home by dusk
    const maxL = Math.max(0, Math.min((back - depart - 1) / 2, HOME_BY - back) * k.speed);
    let pick = -1, score = -Infinity;
    for (let c = 0; c < G * G; c++) {
      const L = dist[c];
      if (!(L >= 5 && L <= maxL) || g.clear[c] < k.radius + 0.9) continue;
      const x = cx(c % G), z = cx(Math.floor(c / G));
      if (spots.some(s => Math.hypot(s[0] - x, s[1] - z) < 3.5)) continue;
      if (boats.some(o => Math.hypot(o.x - x, o.z - z) < 4)) continue;
      const edge = Math.min(x, z, N - x, N - z);
      let s = Math.min(g.clear[c], big ? 5 : 3) + hash(c * 0.37 + r3 * 101) * 2 + Math.min(L, 14) * 0.08;
      if (big) s += Math.max(0, 1 - edge / 10) * 2.5;
      if (s > score) { score = s; pick = c; }
    }
    if (pick < 0) continue;
    const cells: Pt[] = [];
    for (let c = pick; c >= 0; c = prev[c]) cells.push([cx(c % G), cx(Math.floor(c / G))]);
    cells.reverse();
    const path = tidy(g, [[p.x, p.z], ...cells]);
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    v.path = path; v.cum = cum; v.length = cum[cum.length - 1];
    v.travel = Math.max(0.5, v.length / k.speed);
    spots.push(path[path.length - 1]);
  }
  return out;
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

export interface BoatPose { x: number; z: number; rot: number; moving: boolean; home: boolean }

function at(v: Voyage, s: number): Pt {
  const P = v.path!, C = v.cum;
  s = Math.max(0, Math.min(v.length, s));
  let i = 1; while (i < C.length - 1 && C[i] < s) i++;
  const t = (s - C[i - 1]) / Math.max(1e-6, C[i] - C[i - 1]);
  return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t];
}
const rotOf = (dx: number, dz: number) => Math.atan2(-dx, dz);
const turn = (a: number, b: number, t: number) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
const ease = (t: number) => t - Math.sin(t * Math.PI * 2) / (Math.PI * 2);
const sstep = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

/** Where a boat is at this hour. */
export function poseAt(v: Voyage, hour: number): BoatPose {
  const home: BoatPose = { x: v.home.x, z: v.home.z, rot: v.home.rot, moving: false, home: true };
  if (!v.path) return home;
  const t1 = v.depart, t2 = t1 + v.travel, t3 = v.back, t4 = t3 + v.travel;
  if (hour < t1 || hour >= t4) return home;
  const heading = (s: number, dir: 1 | -1) => {
    const a = at(v, s - 0.7), b = at(v, s + 0.7);
    const r = rotOf((b[0] - a[0]) * dir, (b[1] - a[1]) * dir);
    return turn(v.home.rot, r, sstep(s / 1.6));     // swing round as she leaves (or before she berths)
  };
  if (hour < t2) { const s = ease((hour - t1) / v.travel) * v.length; const [x, z] = at(v, s); return { x, z, rot: heading(s, 1), moving: true, home: false }; }
  if (hour >= t3) { const s = (1 - ease((hour - t3) / v.travel)) * v.length; const [x, z] = at(v, s); return { x, z, rot: heading(s, -1), moving: true, home: false }; }
  // out at the spot: a slow swing at anchor
  const [x, z] = at(v, v.length), end = heading(v.length, 1), w = (hour - t2) * 1.3;
  return { x: x + Math.sin(w) * 0.2, z: z + Math.cos(w * 0.7) * 0.2, rot: end + Math.sin(w * 0.8) * 0.5, moving: false, home: false };
}

/**
 * The boats as shown. When a replan moves a boat that is out (the route was blocked, the spot built
 * over), it shrinks away where it was and grows back where it now belongs, like the villagers do.
 */
export class Fleet {
  voyages = new Map<string, Voyage>();
  private shown = new Map<string, { pose: BoatPose; vis: number; frozen: BoatPose | null; check: boolean }>();
  replan(world: World) {
    this.voyages = planVoyages(world);
    for (const id of [...this.shown.keys()]) if (!this.voyages.has(id)) this.shown.delete(id);
    for (const s of this.shown.values()) s.check = true;
  }
  pose(id: string, hour: number, dt: number): (BoatPose & { vis: number }) | null {
    const v = this.voyages.get(id);
    if (!v) return null;
    const live = poseAt(v, hour);
    let s = this.shown.get(id);
    if (!s) { s = { pose: live, vis: 1, frozen: null, check: false }; this.shown.set(id, s); }
    if (s.check) {
      s.check = false;
      const jump = Math.hypot(live.x - s.pose.x, live.z - s.pose.z) > 0.6;
      if (jump && !(live.home && s.pose.home)) s.frozen = s.pose;
    }
    if (s.frozen) {
      s.vis = Math.max(0, s.vis - dt * 3);
      if (s.vis === 0) s.frozen = null;
    } else s.vis = Math.min(1, s.vis + dt * 3);
    s.pose = s.frozen ?? live;
    return { ...s.pose, vis: s.vis };
  }
}
