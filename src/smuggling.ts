// The night trade. A lookout shows a lantern at dusk; a dark boat slips in from the open sea to a
// landing (a grotto's dock, or failing that a pier head); people from the nearest connected house
// carry the crates home along the walkways; the boat is gone before dawn and the crates by the door
// are used up through the next morning. Like the boats and villagers this is all derived from the
// world and the hour dial: nothing is saved or undone, and scrubbing the dial replays the night.
//
// What's missing shows in the world rather than in a panel:
//   lookout, no landing (or no way in from the sea): its lantern gutters and goes out at dusk
//   landing, no walkway from it to a house:           the boat comes in, waits, leaves still loaded
//   landing, no lookout:                               nobody comes
import { World, WATER_Y, DECK_Y, grottoDims, grottoDocks, GROTTO_TIE_Z, type Prop } from "./world.ts";
import { seaRoute } from "./voyages.ts";
import { route, edgeBetween, type Home } from "./villagers.ts";

type Pt = [number, number];
export interface Lookout { house: string; x: number; y: number; z: number }
export interface Landing { kind: "grotto" | "pier"; id: string; node: string | null; x: number; z: number }
interface Seg { ax: number; ay: number; az: number; bx: number; by: number; bz: number; L: number; rope: boolean }
interface Trip { start: number; pickup: number; drop: number; end: number }

export interface RunPlan {
  lookouts: Lookout[];
  /** "run": a boat is coming; "dark": a lookout with nowhere a boat can land; null: no lookout. */
  signal: "run" | "dark" | null;
  landing: Landing | null;
  /** Water route from beyond the map edge to the berth. */
  path: Pt[] | null; cum: number[]; length: number;
  travel: number; arrive: number; leave: number;
  /** The house the crates go to, and the walk from its door to the landing. */
  home: string | null;
  walk: Seg[]; walkLength: number; speed: number;
  crates: number;
  /** Each carrier's trips; trip i of the run carries crate i. */
  carriers: Trip[][];
  stack: { x: number; y: number; z: number; rot: number } | null;
}

export interface Carrier { seed: number; vis: number; phase: "walk" | "idle"; stride: number; x: number; y: number; z: number; heading: number; loaded: boolean }
export interface RunState {
  /** Brightness of the lookout lanterns' signal, 0..1. */
  signal: number;
  boat: { x: number; z: number; rot: number; vis: number; moving: boolean; cargo: number } | null;
  carriers: Carrier[];
  /** Crates by the door: a fixed slot per crate, scaled 0..1 (0: not here yet, or used up). */
  stack: { x: number; y: number; z: number; rot: number; scales: number[] } | null;
}

export const CRATES = 3;
const CARRIERS = 2;
/** Hours on a clock that runs past midnight: 19 → 19, 2 → 26. */
const night = (h: number) => (h < 12 ? h + 24 : h);
const SIGNAL = 19, SET_OUT = 20.2, UNLOAD_BY = 27.5, LEAVE_BY = 27.8;
const BOAT_SPEED = 9, WALK_SPEED = 7, LOAD = 0.15, DROP = 0.12, STAGGER = 0.35;
const sstep = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const ease = (t: number) => t - Math.sin(t * Math.PI * 2) / (Math.PI * 2);

const local = (p: Prop, lx: number, lz: number): Pt => {
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  return [p.x + lx * c - lz * s, p.z + lx * s + lz * c];
};
const nodeAt = (world: World, x: number, z: number, r = 0.35) => {
  for (const n of world.nodes.values()) if (Math.hypot(n.x - x, n.z - z) < r && world.edgesOf(n.id).length) return n.id;
  return null;
};

const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
};
/** Open water alongside a pier head: clear of every deck (never tucked underneath), of houses and of
 *  moored boats; the deepest such spot around the pad. */
function pierBerth(world: World, x: number, z: number, pad: number): Pt | null {
  const r = pad * 0.71 + 0.75;
  let best: Pt | null = null, deep = Infinity;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, bx = x + Math.cos(a) * r, bz = z + Math.sin(a) * r;
    const h = world.height(bx, bz);
    if (h > WATER_Y - 0.3 || world.houseAt(bx, bz, 0.4)) continue;
    let ok = true;
    for (const e of world.edges.values()) {
      const A = world.nodes.get(e.a), B = world.nodes.get(e.b);
      if (A && B && segDist(bx, bz, A.x, A.z, B.x, B.z) < e.width / 2 + 0.55) { ok = false; break; }
    }
    for (const n of world.nodes.values()) if (n.pad > 0 && Math.abs(bx - n.x) < n.pad / 2 + 0.55 && Math.abs(bz - n.z) < n.pad / 2 + 0.55) ok = false;
    for (const p of world.props.values()) if ((p.type === "rowboat" || p.type === "sloop") && Math.hypot(p.x - bx, p.z - bz) < (p.type === "sloop" ? 2.4 : 1.7)) ok = false;
    if (ok && h < deep) { deep = h; best = [bx, bz]; }
  }
  return best;
}

/** The way from a landing node to the nearest house door, as walkable segments (door first). */
function walkHome(world: World, from: string, homes: Home[]) {
  let best: { home: Home; nodes: string[]; L: number } | null = null;
  for (const h of homes) {
    const r = route(world, from, h.node);
    if (!r) continue;
    const ids = [from, ...r];
    let L = 0;
    for (let i = 1; i < ids.length; i++) { const a = world.nodes.get(ids[i - 1])!, b = world.nodes.get(ids[i])!; L += Math.hypot(b.x - a.x, b.z - a.z); }
    if (!best || L < best.L - 1e-6 || (Math.abs(L - best.L) < 1e-6 && h.house < best.home.house)) best = { home: h, nodes: ids.reverse(), L };
  }
  return best;
}

/** Plan tonight's run (if any). `lookouts` come from the houses, `homes` are the villager homes. */
export function planRun(world: World, lookouts: Lookout[], homes: Home[]): RunPlan {
  const plan: RunPlan = {
    lookouts, signal: lookouts.length ? "dark" : null, landing: null, path: null, cum: [0], length: 0,
    travel: 0, arrive: 0, leave: 0, home: null, walk: [], walkLength: 0, speed: WALK_SPEED, crates: CRATES, carriers: [], stack: null,
  };
  if (!lookouts.length) return plan;
  // landings: smugglers want a cave; a pier head will do when no cave has a way home
  const tries: { landing: Landing; path: Pt[] }[] = [];
  const grottos = [...world.props.values()].filter(p => p.type === "grotto").sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const p of grottos) {
    const g = grottoDims(p);
    for (const lx of grottoDocks(p)) {
      const sd = Math.sign(lx) || 1, bx = sd * Math.max(0, g.chan - 0.45);
      const [ax, az] = local(p, bx, 3), berth = local(p, bx, 0.1), [tx, tz] = local(p, lx, GROTTO_TIE_Z);
      const path = seaRoute(world, false, ax, az, [berth]);
      if (path) tries.push({ landing: { kind: "grotto", id: p.id, node: nodeAt(world, tx, tz), x: berth[0], z: berth[1] }, path });
    }
  }
  {
    const pads = [...world.nodes.values()].filter(n => n.pad > 0 && world.edgesOf(n.id).length && n.y < DECK_Y + 0.6).sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const n of pads) {
      if (world.height(n.x, n.z) > WATER_Y - 0.4) continue;
      const b = pierBerth(world, n.x, n.z, n.pad);
      const path = b && seaRoute(world, false, b[0], b[1], [], 1.5);
      if (path) tries.push({ landing: { kind: "pier", id: n.id, node: n.id, x: b![0], z: b![1] }, path });
    }
  }
  // prefer a landing whose walkway reaches a house (a cave over a pier), else the boat comes to a
  // cave anyway and waits there: the hint that its dock wants a walkway
  let pick: (typeof tries)[number] | null = null, walk: ReturnType<typeof walkHome> = null;
  for (const t of tries) {
    const w = t.landing.node ? walkHome(world, t.landing.node, homes) : null;
    if (!w) continue;
    const better = !walk || (t.landing.kind === "grotto" && pick!.landing.kind === "pier") || (t.landing.kind === pick!.landing.kind && w.L < walk.L);
    if (better) { pick = t; walk = w; }
  }
  pick ??= tries[0] ?? null;
  if (!pick) return plan;
  plan.signal = "run"; plan.landing = pick.landing; plan.path = pick.path;
  for (let i = 1; i < pick.path.length; i++) plan.cum.push(plan.cum[i - 1] + Math.hypot(pick.path[i][0] - pick.path[i - 1][0], pick.path[i][1] - pick.path[i - 1][1]));
  plan.length = plan.cum[plan.cum.length - 1];
  plan.travel = Math.min(2.2, Math.max(0.5, plan.length / BOAT_SPEED));
  plan.arrive = SET_OUT + plan.travel;
  if (!walk) { plan.leave = plan.arrive + 1.5; return plan; }

  // the carriers' walk, door first, with rope bridges sagging as they do for everyone else
  plan.home = walk.home.house;
  for (let i = 1; i < walk.nodes.length; i++) {
    const a = world.nodes.get(walk.nodes[i - 1])!, b = world.nodes.get(walk.nodes[i])!;
    plan.walk.push({ ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, L: Math.hypot(b.x - a.x, b.z - a.z), rope: edgeBetween(world, a.id, b.id)?.style === "rope" });
  }
  const L = plan.walkLength = walk.L, trips = Math.ceil(CRATES / CARRIERS);
  const schedule = (v: number) => Math.max(SIGNAL + 0.6, plan.arrive - L / v);
  let v = WALK_SPEED, s0 = schedule(v);
  const late = (v: number, s0: number) => s0 + STAGGER * (CARRIERS - 1) + trips * (2 * L / v + LOAD + DROP) > UNLOAD_BY;
  if (late(v, s0)) { v = Math.max(v, (2 * L * trips) / Math.max(0.5, UNLOAD_BY - s0 - STAGGER * (CARRIERS - 1) - trips * (LOAD + DROP))); s0 = schedule(v); }
  plan.speed = v;
  plan.carriers = Array.from({ length: CARRIERS }, () => []);
  let last = plan.arrive;
  for (let i = 0; i < CRATES; i++) {
    const k = i % CARRIERS, list = plan.carriers[k];
    const start = list.length ? list[list.length - 1].end : s0 + STAGGER * k;
    // nobody loads before the boat is in
    const pickup = Math.max(start + L / v, plan.arrive) + LOAD;
    const drop = pickup + L / v;
    list.push({ start, pickup, drop, end: drop + DROP });
    last = Math.max(last, pickup);
  }
  plan.leave = Math.min(LEAVE_BY, Math.max(plan.arrive + 0.8, last + 0.15));
  // crates stack beside the door, back from the wall
  const d = plan.walk[0];
  const ux = (d.ax - d.bx) / (d.L || 1), uz = (d.az - d.bz) / (d.L || 1);
  plan.stack = { x: d.ax - ux * 0.25 + uz * 0.42, y: d.ay, z: d.az - uz * 0.25 - ux * 0.42, rot: Math.atan2(ux, uz) };
  return plan;
}

function boatAt(plan: RunPlan, s: number): Pt {
  const P = plan.path!, C = plan.cum;
  s = Math.max(0, Math.min(plan.length, s));
  let i = 1; while (i < C.length - 1 && C[i] < s) i++;
  const t = (s - C[i - 1]) / Math.max(1e-6, C[i] - C[i - 1]);
  return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t];
}
const rotOf = (dx: number, dz: number) => Math.atan2(-dx, dz);
const turn = (a: number, b: number, t: number) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

function walkAt(plan: RunPlan, s: number, lane: number) {
  let i = 0;
  while (i < plan.walk.length - 1 && s > plan.walk[i].L) { s -= plan.walk[i].L; i++; }
  const g = plan.walk[i], t = Math.max(0, Math.min(1, s / (g.L || 1)));
  const ux = (g.bx - g.ax) / (g.L || 1), uz = (g.bz - g.az) / (g.L || 1), off = lane * Math.min(1, Math.sin(Math.PI * t) * 3);
  let y = g.ay + (g.by - g.ay) * t;
  if (g.rope) y -= Math.sin(Math.PI * t) * Math.min(0.9, 0.06 * g.L + 0.05);
  return { x: g.ax + (g.bx - g.ax) * t - uz * off, y, z: g.az + (g.bz - g.az) * t + ux * off, ux, uz };
}

/** Everything about the run at this hour. Pure: the same plan and hour always give the same scene. */
export function runAt(plan: RunPlan, hour: number): RunState {
  const n = night(hour);
  const out: RunState = { signal: 0, boat: null, carriers: [], stack: null };
  // the lantern: steady flashes while a boat is called in; a short gutter and out when none can come
  if (plan.signal === "run" && n >= SIGNAL && n < SIGNAL + 1.4) {
    const env = sstep((n - SIGNAL) / 0.1) * sstep((SIGNAL + 1.4 - n) / 0.1);
    out.signal = env * (((n - SIGNAL) * 12) % 1 < 0.55 ? 1 : 0.12);
  } else if (plan.signal === "dark" && n >= SIGNAL && n < SIGNAL + 0.7) {
    const k = (n - SIGNAL) / 0.7, flick = 0.65 + 0.35 * Math.sin(n * 157) * Math.sin(n * 61);
    out.signal = 0.45 * sstep(k / 0.1) * (1 - sstep((k - 0.55) / 0.45)) * flick;
  }
  if (!plan.path) return out;
  const delivered = plan.carriers.flat();
  // the boat: in, alongside, out again
  const t1 = SET_OUT, t2 = plan.arrive, t3 = plan.leave, t4 = plan.leave + plan.travel;
  if (n >= t1 && n < t4) {
    const picked = delivered.filter(t => n >= t.pickup).length;
    const cargo = plan.home ? CRATES - picked : CRATES;
    const fade = sstep((n - t1) / 0.12) * sstep((t4 - n) / 0.12);
    const berth = boatAt(plan, plan.length), inRot = (() => { const a = boatAt(plan, plan.length - 1.2); return rotOf(berth[0] - a[0], berth[1] - a[1]); })();
    if (n < t2) {
      const s = ease((n - t1) / plan.travel) * plan.length, [x, z] = boatAt(plan, s), a = boatAt(plan, s - 0.7), b = boatAt(plan, s + 0.7);
      out.boat = { x, z, rot: rotOf(b[0] - a[0], b[1] - a[1]), vis: fade, moving: true, cargo };
    } else if (n < t3) {
      out.boat = { x: berth[0], z: berth[1], rot: inRot + Math.sin(n * 3) * 0.04, vis: fade, moving: false, cargo };
    } else {
      const s = (1 - ease((n - t3) / plan.travel)) * plan.length, [x, z] = boatAt(plan, s), a = boatAt(plan, s + 0.7), b = boatAt(plan, s - 0.7);
      // swing round off the berth before heading out
      const r = rotOf(b[0] - a[0], b[1] - a[1]);
      out.boat = { x, z, rot: turn(inRot, r, sstep((plan.length - s) / 1.6)), vis: fade, moving: true, cargo };
    }
  }
  // carriers: out from the door, load at the landing, back with a crate
  const L = plan.walkLength, v = plan.speed;
  plan.carriers.forEach((trips, k) => {
    if (!trips.length) return;
    const first = trips[0].start, done = trips[trips.length - 1].end;
    if (n < first || n > done + 0.1) return;
    const seed = ((plan.home ?? "").length * 0.131 + k * 0.377 + 0.21) % 1;
    const c: Carrier = { seed, vis: sstep((n - first) / 0.08) * sstep((done + 0.1 - n) / 0.08), phase: "idle", stride: 0, x: 0, y: 0, z: 0, heading: 0, loaded: false };
    const trip = trips.find(t => n < t.end) ?? trips[trips.length - 1];
    let s: number, back = false;
    if (n < trip.pickup - LOAD) { s = Math.min(L, (n - trip.start) * v); c.phase = s < L ? "walk" : "idle"; }
    else if (n < trip.pickup) { s = L; }
    else if (n < trip.drop) { s = L - (n - trip.pickup) * v; back = true; c.loaded = true; c.phase = "walk"; }
    else { s = 0; back = true; }
    const p = walkAt(plan, s, (back ? -0.18 : 0.18) * (k ? 1 : -1));
    c.x = p.x; c.y = p.y; c.z = p.z; c.heading = back ? Math.atan2(-p.ux, -p.uz) : Math.atan2(p.ux, p.uz);
    c.stride = trips.indexOf(trip) * 2 * L + (back ? 2 * L - s : s);
    out.carriers.push(c);
  });
  // crates by the door: each appears when dropped and is used up through the morning (gone by noon)
  if (plan.stack && delivered.length) {
    const drops = delivered.map(t => t.drop).sort((a, b) => a - b);
    const scales: number[] = [];
    drops.forEach((d, i) => {
      const use = 31 + i * 1.4;
      scales.push(n < d ? 0 : sstep((n - d) / 0.05) * (1 - sstep((n - use) / 0.8)));
    });
    if (scales.some(s => s > 0.001)) out.stack = { ...plan.stack, scales };
  }
  return out;
}

