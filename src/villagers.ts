import { DECK_Y, grottoTies, grottoTieAt, grottoDockWalk, type World, type WalkNode, type WalkEdge } from "./world.ts";

/** The walkable network: walkway nodes and edges, plus any grotto docks they tie on to. */
export type Paths = Pick<World, "nodes" | "edges">;

/**
 * Villagers: a few people per house, living only on the walkway network. They are derived from the
 * world (never saved, never in undo). A house needs a walkway reaching one of its walls (a door) to
 * have anyone; its people stroll the walkways connected to that door, pause, and sometimes go home.
 * Three-free so it can be tested in node; the renderer reads `people` each frame.
 */

/** A house with a walkway at its door: `node` is the walk node against the wall. */
export interface Home { house: string; node: string; seed: number; size: number }

export type Phase = "in" | "walk" | "idle" | "out" | "home";
export interface Villager {
  id: string;
  house: string;
  seed: number;
  /** Lateral lane on the deck, as a fraction of half the width. */
  lane: number;
  speed: number;
  phase: Phase;
  /** 0 → 1 while appearing, 1 → 0 while leaving. */
  vis: number;
  /** Node ids still to walk; `from` is where the current leg started. */
  from: string;
  path: string[];
  /** Distance travelled along the current leg. */
  d: number;
  wait: number;
  /** Leaving for good (house gone) rather than just ducking indoors. */
  gone: boolean;
  x: number; y: number; z: number; heading: number;
  /** Walk cycle phase, advances with distance. */
  stride: number;
}

export const MAX_VILLAGERS = 14;
const SPEED = 0.55, FADE = 1.6;

/** How busy the walkways get: people per unit of walkway length. */
export const CROWDS = [
  { name: "Quiet", density: 0.12 },
  { name: "Lively", density: 0.22 },
  { name: "Bustling", density: 0.36 },
] as const;
export const DEFAULT_CROWD = 1;
/** localStorage key for the chosen crowd level. */
export const CROWD_KEY = "grotto.crowd";

const byId = (a: Home, b: Home) => (a.house < b.house ? -1 : a.house > b.house ? 1 : 0);

/**
 * One person per house, a second for larger houses when there's room. Each connected
 * stretch of walkway holds at most `density` people per unit of its length (at least one),
 * and the whole town at most MAX_VILLAGERS. Earliest house ids win, so counts stay stable.
 */
export function headcount(homes: Home[], world?: Paths, density = Infinity) {
  const out = new Map<string, number>();
  const groups = new Map<string, { room: number; homes: Home[] }>();
  if (world && Number.isFinite(density)) {
    const adj = adjacency(world), compOf = new Map<string, string>();
    for (const h of homes) {
      let key = compOf.get(h.node);
      if (!key) {
        const seen = new Set([h.node]), q = [h.node];
        while (q.length) for (const n of adj.get(q.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); }
        let len = 0;
        for (const e of world.edges.values()) if (seen.has(e.a) && seen.has(e.b)) {
          const a = world.nodes.get(e.a)!, b = world.nodes.get(e.b)!;
          len += Math.hypot(b.x - a.x, b.z - a.z);
        }
        key = h.node;
        for (const n of seen) compOf.set(n, key);
        groups.set(key, { room: Math.max(1, Math.floor(len * density)), homes: [] });
      }
      groups.get(key)!.homes.push(h);
    }
  } else groups.set("", { room: Infinity, homes: [...homes] });
  let total = 0;
  for (const g of groups.values()) {
    g.homes.sort(byId);
    for (const h of g.homes) if (g.room > 0 && total < MAX_VILLAGERS) { out.set(h.house, 1); g.room--; total++; }
  }
  for (const g of groups.values()) for (const h of [...g.homes].sort((a, b) => b.size - a.size || byId(a, b))) {
    if (h.size < 2 || !out.has(h.house) || g.room <= 0 || total >= MAX_VILLAGERS) continue;
    out.set(h.house, 2); g.room--; total++;
  }
  return out;
}

function rand(seed: number) {
  let s = (Math.floor(seed * 2654435761) >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export class Villagers {
  people: Villager[] = [];
  private homes = new Map<string, Home>();
  private r = rand(7);
  /** People per unit of walkway; see CROWDS. */
  density: number = CROWDS[DEFAULT_CROWD].density;

  /** Reconcile with the world: new houses send someone out, removed ones fade, broken paths reset. */
  sync(world: Paths, homes: Home[]) {
    this.homes = new Map(homes.map(h => [h.house, h]));
    const want = headcount(homes, world, this.density);
    const have = new Map<string, number>();
    for (const v of this.people) {
      if (v.gone) continue;
      const k = Number(v.id.split("#")[1]);
      const home = this.homes.get(v.house);
      if (!home || k >= (want.get(v.house) ?? 0)) { this.leave(v, true); continue; }
      have.set(v.house, Math.max(have.get(v.house) ?? 0, k + 1));
      if (!this.valid(world, v, home)) this.leave(v, false);
    }
    for (const [house, n] of want) for (let k = have.get(house) ?? 0; k < n; k++) {
      const home = this.homes.get(house)!;
      this.people.push(this.spawn(world, home, k));
    }
  }

  private spawn(world: Paths, home: Home, k: number): Villager {
    const r = rand(home.seed * 13.7 + k * 3.1);
    const n = world.nodes.get(home.node)!;
    const v: Villager = {
      id: `${home.house}#${k}`, house: home.house, seed: r(), lane: (r() - 0.5) * 0.9, speed: SPEED * (0.8 + r() * 0.4),
      phase: "in", vis: 0, from: home.node, path: [], d: 0, wait: k * 2.5 + r() * 1.5, gone: false,
      x: n.x, y: n.y, z: n.z, heading: r() * Math.PI * 2, stride: 0,
    };
    return v;
  }

  /** Still standing on walkway that exists and reaches home? */
  private valid(world: Paths, v: Villager, home: Home) {
    if (v.phase === "home" || v.phase === "out") return true;
    if (!world.nodes.has(v.from)) return false;
    const reach = component(world, home.node);
    if (!reach.has(v.from)) return false;
    if (v.path.length) {
      if (!edgeBetween(world, v.from, v.path[0])) return false;
      for (let i = 0; i < v.path.length; i++) if (!reach.has(v.path[i]) || (i && !edgeBetween(world, v.path[i - 1], v.path[i]))) return false;
    }
    return true;
  }

  private leave(v: Villager, gone: boolean) {
    if (gone) v.gone = true;
    if (v.phase !== "home") v.phase = "out";
  }

  update(world: Paths, dt: number) {
    dt = Math.min(dt, 0.25);
    for (const v of this.people) this.step(world, v, dt);
    this.people = this.people.filter(v => !(v.gone && v.phase === "home"));
  }

  private step(world: Paths, v: Villager, dt: number) {
    const home = this.homes.get(v.house);
    switch (v.phase) {
      case "out":
        v.vis = Math.max(0, v.vis - dt * FADE);
        if (v.vis <= 0) { v.phase = "home"; v.wait = 3 + this.r() * 6; v.path = []; }
        return;
      case "home": {
        if (v.gone || !home) return;
        v.wait -= dt;
        if (v.wait > 0) return;
        const n = world.nodes.get(home.node);
        if (!n) return;
        v.from = home.node; v.path = []; v.d = 0; v.x = n.x; v.y = n.y; v.z = n.z;
        v.phase = "in"; v.wait = 0.4 + this.r();
        return;
      }
      case "in":
        if (v.wait > 0) { v.wait -= dt; return; }
        v.vis = Math.min(1, v.vis + dt * FADE);
        if (v.vis >= 1) this.plan(world, v);
        return;
      case "idle":
        v.wait -= dt;
        if (v.wait <= 0) this.plan(world, v);
        return;
      case "walk": this.walk(world, v, dt);
    }
  }

  /** Choose somewhere to go: another node on the network, or back to the door to go in. */
  private plan(world: Paths, v: Villager) {
    const home = this.homes.get(v.house);
    if (!home) { this.leave(v, true); return; }
    const reach = [...component(world, home.node)];
    const atHome = v.from === home.node;
    let target: string;
    if (!atHome && this.r() < 0.3) target = home.node;
    else {
      const others = reach.filter(id => id !== v.from);
      if (!others.length) { v.phase = "idle"; v.wait = 3 + this.r() * 4; return; }
      target = others[Math.floor(this.r() * others.length)];
    }
    const path = route(world, v.from, target);
    if (!path) { this.leave(v, false); return; }
    v.path = path; v.d = 0; v.phase = "walk";
  }

  private walk(world: Paths, v: Villager, dt: number) {
    let left = v.speed * dt;
    while (left > 0 && v.path.length) {
      const a = world.nodes.get(v.from), b = world.nodes.get(v.path[0]);
      if (!a || !b) { this.leave(v, false); return; }
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      const go = Math.min(left, L - v.d);
      v.d += go; left -= go; v.stride += go;
      if (v.d >= L - 1e-6) { v.from = v.path.shift()!; v.d = 0; }
    }
    this.place(world, v);
    if (!v.path.length) {
      const home = this.homes.get(v.house);
      if (home && v.from === home.node && this.r() < 0.7) { v.phase = "out"; return; }
      v.phase = "idle"; v.wait = 2 + this.r() * 5;
    }
  }

  /** World position on the current leg, offset into the villager's lane, following rope-bridge sag. */
  private place(world: Paths, v: Villager) {
    const a = world.nodes.get(v.from)!;
    const b = v.path.length ? world.nodes.get(v.path[0]) : undefined;
    if (!b) { v.x = a.x; v.y = a.y; v.z = a.z; return; }
    const e = edgeBetween(world, a.id, b.id);
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.max(1e-6, Math.hypot(dx, dz));
    const t = v.d / L, ux = dx / L, uz = dz / L;
    // ease into the lane away from the posts so junctions don't make people jump sideways
    const lane = v.lane * ((e?.width ?? 1) / 2 - 0.15) * Math.min(1, Math.sin(Math.PI * t) * 3);
    v.x = a.x + dx * t - uz * lane; v.z = a.z + dz * t + ux * lane;
    v.y = a.y + (b.y - a.y) * t;
    if (e?.style === "rope") v.y -= Math.sin(Math.PI * t) * Math.min(0.9, 0.06 * L + 0.05);
    v.heading = Math.atan2(ux, uz);
  }
}

export function edgeBetween(world: Paths, a: string, b: string) {
  for (const e of world.edges.values()) if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e;
  return undefined;
}

function adjacency(world: Paths) {
  const adj = new Map<string, string[]>();
  for (const e of world.edges.values()) {
    if (!world.nodes.has(e.a) || !world.nodes.has(e.b)) continue;
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e.b);
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e.a);
  }
  return adj;
}

export function component(world: Paths, start: string) {
  const adj = adjacency(world);
  const seen = new Set<string>([start]), q = [start];
  while (q.length) for (const n of adj.get(q.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); }
  return seen;
}

/** Shortest walk (by length) from a to b, excluding a; null if unreachable. */
export function route(world: Paths, a: string, b: string): string[] | null {
  if (a === b) return [];
  const adj = adjacency(world);
  const dist = new Map<string, number>([[a, 0]]), prev = new Map<string, string>();
  const open = new Set([a]);
  const P = (id: string) => world.nodes.get(id) as WalkNode;
  while (open.size) {
    let cur = "", best = Infinity;
    for (const id of open) { const d = dist.get(id)!; if (d < best) { best = d; cur = id; } }
    open.delete(cur);
    if (cur === b) break;
    for (const n of adj.get(cur) ?? []) {
      const d = best + Math.hypot(P(n).x - P(cur).x, P(n).z - P(cur).z, P(n).y - P(cur).y);
      if (d < (dist.get(n) ?? Infinity)) { dist.set(n, d); prev.set(n, cur); open.add(n); }
    }
  }
  if (!prev.has(b)) return null;
  const out: string[] = [];
  for (let c = b; c !== a; c = prev.get(c)!) out.unshift(c);
  return out;
}

/**
 * The walkways as people walk them: where a walkway ties on to a grotto's dock, the dock carries on
 * in under the arch as a couple of extra stops. Built per sync; shares the real nodes.
 */
export function walkGraph(world: World): Paths {
  const grottos = [...world.props.values()].filter(p => p.type === "grotto");
  if (!grottos.length) return world;
  const nodes = new Map(world.nodes), edges = new Map(world.edges);
  for (const p of grottos) for (const tp of grottoTies(p)) {
    let tie: WalkNode | undefined;
    for (const n of world.nodes.values()) if (Math.hypot(n.x - tp.x, n.z - tp.z) < 0.35 && world.edgesOf(n.id).length) { tie = n; break; }
    const t = tie && grottoTieAt(world, tie.x, tie.z);
    if (!tie || !t) continue;
    let prev = tie;
    grottoDockWalk(t).forEach((q, k) => {
      const n: WalkNode = { id: `${tie.id}~dock${k}`, x: q.x, z: q.z, y: DECK_Y, pad: 0 };
      const e: WalkEdge = { id: `${n.id}~e`, a: prev.id, b: n.id, width: 0.5, style: "deck", rail: false };
      nodes.set(n.id, n); edges.set(e.id, e); prev = n;
    });
  }
  return { nodes, edges };
}
