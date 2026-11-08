import { World, N, uid, WATER_Y, MAX_LEVEL, PAINT_CH, isGreenery, isLandmark, isShop, type PaintType, type PropType, type Prop, type WalkNode, type WalkEdge } from "./world.ts";
import { defaultDeckY, WALK_W, MAX_STAIR, slopeOf, isStairs, clampStair } from "./walkway-rules.ts";
import { doorOf } from "./house-model.ts";
import { fitLandmark } from "./placement.ts";

export type WorldChange = { terrain?: true; paint?: true; structures?: true };
export type TerrainOp = "raise" | "lower" | "flatten" | "smooth";
export type EditResult<T> = { ok: true; value: T; change: WorldChange } | { ok: false; why: string };
const propChange = (type: PropType): WorldChange => type === "grotto" ? { terrain: true, structures: true } : { structures: true };
import { grottoTieAt, shopDoorAt } from "./world.ts";

/** Three-free editing rules shared by gestures and cove generation. Does not own history or rendering. */
export class WorldOps {
  readonly world: World;
  constructor(world: World) { this.world = world; }
  // ---------- helpers used by tools and the starter ----------
  addNode(x: number, z: number, y?: number, pad = 0): WalkNode {
    const n: WalkNode = { id: uid("n"), x, z, y: y ?? defaultDeckY(this.world, x, z), pad };
    this.world.nodes.set(n.id, n); return n;
  }
  addEdge(a: WalkNode, b: WalkNode, style: WalkEdge["style"] = "deck", width = WALK_W): WalkEdge {
    const e: WalkEdge = { id: uid("e"), a: a.id, b: b.id, width, style, rail: false };
    this.world.edges.set(e.id, e); return e;
  }
  addProp(type: PropType, x: number, z: number, rot = 0, seed = Math.random()): Prop {
    const p: Prop = { id: uid("p"), type, x, z, rot, seed };
    this.world.props.set(p.id, p);
    if (type === "grotto") this.carveGrotto(p);
    return p;
  }
  /**
   * Keep walkways out of the ground. Samples each stretch across its full width; where the ground rises through the deck,
   * a post goes in at the worst point, lifted clear (recursively). Posts buried on a side slope are raised.
   * Returns true if anything changed.
   */
  settleWalks(only?: Set<string>): boolean {
    const w = this.world;
    let changed = false;
    const touched = new Set<string>();
    const Hc = (x: number, z: number) => w.height(Math.min(N - 0.01, Math.max(0.01, x)), Math.min(N - 0.01, Math.max(0.01, z)));
    const nearHouse = (n: WalkNode) => !!doorOf(w, n) || !!grottoTieAt(w, n.x, n.z) || !!shopDoorAt(w, n.x, n.z, 0.3);
    // posts: a deck sitting in a side slope comes up to clear the ground under its footprint
    for (const n of w.nodes.values()) {
      if (only && !only.has(n.id)) continue;
      if (!w.edgesOf(n.id).length || nearHouse(n)) continue;
      const r = Math.max(0.5, w.edgesOf(n.id).reduce((m, e) => Math.max(m, e.width), 0.6) / 2);
      let g = -Infinity;
      for (let k = 0; k < 8; k++) g = Math.max(g, Hc(n.x + Math.cos(k * 0.785) * r, n.z + Math.sin(k * 0.785) * r));
      g = Math.max(g, Hc(n.x, n.z));
      if (g + 0.1 > n.y) { n.y = Math.round((g + 0.16) * 20) / 20; changed = true; touched.add(n.id); }
    }
    const settle = (e: WalkEdge, depth: number) => {
      const A = w.nodes.get(e.a), B = w.nodes.get(e.b); if (!A || !B || e.style === "rope") return;
      const L = Math.hypot(B.x - A.x, B.z - A.z); if (L < 0.9 || depth > 5) return;
      const ux = (B.x - A.x) / L, uz = (B.z - A.z) / L, hw = e.width / 2;
      let worst = 0, wt = 0, wg = 0;
      for (let t = 0.06; t < 0.95; t += 0.04) {
        const x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t, y = A.y + (B.y - A.y) * t;
        let g = -Infinity;
        for (const o of [-hw, -hw / 2, 0, hw / 2, hw]) g = Math.max(g, Hc(x - uz * o, z + ux * o));
        const over = g + 0.1 - y;
        if (over > worst) { worst = over; wt = t; wg = g; }
      }
      if (worst < 0.06) return;
      // never right against an end: that makes stubby sawtooth steps (or a post on top of a post)
      const t = Math.min(1 - 0.4 / L, Math.max(0.4 / L, wt));
      const q = (a: number, b: number) => Math.abs(a - b) < 1e-6 ? a : Math.round((a + (b - a) * t) * 4) / 4; // a straight run stays on its line
      const x = q(A.x, B.x), z = q(A.z, B.z);
      if (Math.hypot(x - A.x, z - A.z) < 0.24 || Math.hypot(x - B.x, z - B.z) < 0.24) return;
      let g = wg;
      for (const o of [-hw, 0, hw]) g = Math.max(g, Hc(x - uz * o, z + ux * o));
      const m = this.addNode(x, z, Math.round((g + 0.18) * 20) / 20);
      const [e1, e2] = w.splitEdge(e.id, m);
      changed = true; touched.add(m.id);
      settle(e1, depth + 1); settle(e2, depth + 1);
    };
    for (const e of [...w.edges.values()]) if (!only || only.has(e.a) || only.has(e.b)) settle(e, 0);
    if (changed) this.easeStairs(touched);
    return changed;
  }
  /**
   * Where a stretch next to one of `from` climbs steeper than MAX_STAIR, lift its lower post until it doesn't,
   * and carry on along the walkway from there. Dead ends at a house (doors) keep their height.
   * With no `from`, every stretch is checked.
   */
  easeStairs(from?: Set<string>) {
    const w = this.world;
    const live = from ? new Set(from) : new Set(w.nodes.keys());
    for (let pass = 0; pass < 40 && live.size; pass++) {
      const next = new Set<string>();
      for (const id of live) for (const e of w.edgesOf(id)) {
        const A = w.nodes.get(e.a), B = w.nodes.get(e.b); if (!A || !B) continue;
        const L = Math.hypot(B.x - A.x, B.z - A.z);
        if (slopeOf(A, B) <= MAX_STAIR + 1e-6) continue;
        const [lo, hi] = A.y < B.y ? [A, B] : [B, A];
        if (w.edgesOf(lo.id).length === 1 && doorOf(w, lo)) continue; // a door: the floor sets it
        if (grottoTieAt(w, lo.x, lo.z)) continue; // a grotto quay sits at deck height
        lo.y = Math.ceil((hi.y - MAX_STAIR * L) * 20 - 1e-6) / 20;
        next.add(lo.id);
      }
      live.clear(); for (const id of next) live.add(id);
    }
  }

  /**
   * Fold away posts a walkway doesn't need: a post with two stretches that carry on in a straight line, at an even grade,
   * when the joined stretch would still clear the ground. Doors, grotto docks and landings stay.
   * With no `only`, every post is considered. Returns true if anything was removed.
   */
  /** does a deck from A to B clear the ground across its width? */
  private clears(A: { x: number; z: number; y: number }, B: { x: number; z: number; y: number }, width: number) {
    const w = this.world;
    const Hc = (x: number, z: number) => w.height(Math.min(N - 0.01, Math.max(0.01, x)), Math.min(N - 0.01, Math.max(0.01, z)));
    const L = Math.hypot(B.x - A.x, B.z - A.z) || 1, ux = (B.x - A.x) / L, uz = (B.z - A.z) / L, hw = width / 2;
    for (let t = 0.06; t < 0.95; t += 0.04) {
      const x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t, y = A.y + (B.y - A.y) * t;
      for (const o of [-hw, -hw / 2, 0, hw / 2, hw]) if (Hc(x - uz * o, z + ux * o) + 0.1 - y >= 0.06) return false;
    }
    return true;
  }
  /**
   * Smooth out stubby flights: a post partway along a walkway that sits off the even grade between its neighbours
   * (so one short stretch takes the whole climb as a few stairs) drops or rises onto that grade, if the deck still clears the ground.
   */
  fairStairs(only?: Iterable<string>): boolean {
    const w = this.world;
    const Hc = (x: number, z: number) => w.height(Math.min(N - 0.01, Math.max(0.01, x)), Math.min(N - 0.01, Math.max(0.01, z)));
    let changed = false;
    const ids = only ? [...only] : [...w.nodes.keys()];
    for (let pass = 0; pass < 3; pass++) for (const id of ids) {
      const n = w.nodes.get(id); if (!n || n.pad > 0) continue;
      const es = w.edgesOf(id); if (es.length !== 2 || es.some(e => e.style === "rope")) continue;
      if (doorOf(w, n) || grottoTieAt(w, n.x, n.z)) continue;
      const A = w.nodes.get(es[0].a === id ? es[0].b : es[0].a)!, B = w.nodes.get(es[1].a === id ? es[1].b : es[1].a)!;
      const la = Math.hypot(n.x - A.x, n.z - A.z), lb = Math.hypot(n.x - B.x, n.z - B.z);
      const stub = (o: WalkNode, l: number) => l < 1.6 && isStairs(n, o);
      if (!stub(A, la) && !stub(B, lb)) continue;
      const y = Math.round((A.y + (B.y - A.y) * la / (la + lb)) * 20) / 20;
      const m = { ...n, y };
      if (isStairs(m, A) || isStairs(m, B)) continue;
      let g = Hc(n.x, n.z);
      for (let k = 0; k < 8; k++) g = Math.max(g, Hc(n.x + Math.cos(k * 0.785) * 0.55, n.z + Math.sin(k * 0.785) * 0.55));
      if (g + 0.1 > y || !this.clears(A, m, es[0].width) || !this.clears(m, B, es[1].width)) continue;
      n.y = y; changed = true;
    }
    return changed;
  }
  mergeInline(only?: Iterable<string>): boolean {
    const w = this.world;
    let changed = this.fairStairs(only);
    for (const id of only ? [...only] : [...w.nodes.keys()]) {
      const n = w.nodes.get(id); if (!n || n.pad > 0) continue;
      const es = w.edgesOf(id); if (es.length !== 2) continue;
      const [e1, e2] = es;
      if (e1.style !== e2.style || e1.style === "rope" || Math.abs(e1.width - e2.width) > 1e-3 || e1.rail !== e2.rail) continue;
      const A = w.nodes.get(e1.a === id ? e1.b : e1.a)!, B = w.nodes.get(e2.a === id ? e2.b : e2.a)!;
      if (A === B || w.edgesOf(A.id).some(e => e.a === B.id || e.b === B.id)) continue;
      if (doorOf(w, n) || grottoTieAt(w, n.x, n.z)) continue;
      const L = Math.hypot(B.x - A.x, B.z - A.z), la = Math.hypot(n.x - A.x, n.z - A.z);
      if (L > 14 || L < 0.1) continue;
      // in line: n sits within a few centimetres of the straight run from A to B
      const off = Math.abs((B.x - A.x) * (n.z - A.z) - (B.z - A.z) * (n.x - A.x)) / L;
      if (off > 0.05 || la <= 0 || la >= L) continue;
      // even grade: the joined deck passes through n's height
      if (Math.abs(A.y + (B.y - A.y) * la / L - n.y) > 0.06) continue;
      if (slopeOf(A, B) > MAX_STAIR + 1e-6) continue;
      if (!this.clears(A, B, e1.width)) continue;
      w.edges.delete(e2.id); w.nodes.delete(id);
      w.edges.set(e1.id, { ...e1, a: A.id, b: B.id });
      changed = true;
    }
    return changed;
  }
  /** take a post out of a walkway; a post in the middle of a run is bridged over rather than leaving a gap */
  removePost(id: string) {
    const w = this.world, es = w.edgesOf(id);
    if (es.length === 2 && es[0].style === es[1].style) {
      const [e1, e2] = es, a = e1.a === id ? e1.b : e1.a, b = e2.a === id ? e2.b : e2.a;
      const A = w.nodes.get(a), B = w.nodes.get(b);
      if (A && B && a !== b && !w.edgesOf(a).some(e => e.a === b || e.b === b) && Math.hypot(B.x - A.x, B.z - A.z) <= 14) {
        w.removeNode(id);
        w.edges.set(e1.id, { ...e1, a, b });
        this.easeStairs(new Set([a, b]));
        this.settleWalks(new Set([a, b]));
        return;
      }
    }
    w.removeNode(id); w.pruneNodes();
  }

  carveGrotto(_p: Prop) { this.world.rebuildCarving(); }
  /** Apply one brush sample against a snapshot of the affected cells (smoothing must not read its own writes). */
  terrainStroke(op: TerrainOp, x: number, z: number, r: number, flat?: number): WorldChange | null {
    const cells: [number, number][] = [];
    for (let j = Math.floor(z - r); j <= Math.ceil(z + r); j++) for (let i = Math.floor(x - r); i <= Math.ceil(x + r); i++) {
      if (i >= 0 && j >= 0 && i < N && j < N && Math.hypot(i + 0.5 - x, j + 0.5 - z) <= r) cells.push([i, j]);
    }
    const orig = cells.map(([i, j]) => this.world.baseLevel(i, j));
    let changed = false;
    cells.forEach(([i, j], k) => {
      const l = orig[k];
      let next = l;
      if (op === "raise") next = l + 1;
      else if (op === "lower") next = l - 1;
      else if (op === "flatten") next = l + Math.sign((flat ?? l) - l);
      else {
        let sum = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) sum += this.world.baseLevel(i + di, j + dj);
        next = Math.round(sum / 9);
      }
      next = Math.max(0, Math.min(MAX_LEVEL, next));
      if (next !== l) { this.world.setLevel(i, j, next); changed = true; }
    });
    return changed ? { terrain: true } : null;
  }

  paintDisc(type: PaintType | "erase", x: number, z: number, r: number, strength = 1) {
    const w = this.world;
    for (let j = Math.floor(z - r - 1); j <= Math.ceil(z + r); j++) for (let i = Math.floor(x - r - 1); i <= Math.ceil(x + r); i++) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const d = Math.hypot(i + 0.5 - x, j + 0.5 - z);
      if (d > r + 0.5) continue;
      const f = Math.min(1, (r + 0.5 - d) / 1.0) * strength;
      const k = (j * N + i) * 4;
      if (type === "erase") { for (let c = 0; c < 4; c++) w.paint[k + c] = Math.max(0, w.paint[k + c] - f * 255); continue; }
      const ch = PAINT_CH[type];
      w.paint[k + ch] = Math.min(255, Math.max(w.paint[k + ch], f * 255));
      for (let c = 0; c < 4; c++) if (c !== ch) w.paint[k + c] = Math.max(0, w.paint[k + c] - f * 180);
    }
  }

  /** Fit, validate and add a landmark using the same solver as the placement ghost. */
  placeLandmark(type: PropType, x: number, z: number, seed: number, opts?: Prop["opts"], flip = false, heading?: number): EditResult<Prop> {
    if (!isLandmark(type) || ![x, z, seed].every(Number.isFinite)) return { ok: false, why: "Invalid landmark" };
    const fit = fitLandmark(this.world, type, x, z, seed, opts, flip, "ghost", heading);
    if (!fit.ok) return { ok: false, why: fit.why ?? "Won't fit here" };
    const p: Prop = { id: uid("p"), type, x: fit.x, z: fit.z, rot: fit.rot, seed, ...(opts && Object.keys(opts).length ? { opts: { ...opts } } : {}) };
    this.world.props.set(p.id, p);
    if (type === "grotto") this.world.rebuildCarving();
    return { ok: true, value: p, change: propChange(type) };
  }

  /** A rejected revision leaves the live prop untouched, including its grotto carving. */
  reviseProp(id: string, patch: Partial<Pick<Prop, "x" | "z" | "rot" | "seed" | "scale" | "opts">>): EditResult<Prop> {
    const current = this.world.props.get(id);
    if (!current) return { ok: false, why: "Prop no longer exists" };
    const candidate = { ...current, ...patch };
    if (![candidate.x, candidate.z, candidate.rot, candidate.seed].every(Number.isFinite)) return { ok: false, why: "Invalid prop position or variant" };
    if (isLandmark(candidate.type)) {
      const fit = fitLandmark(this.world, candidate.type, candidate.x, candidate.z, candidate.seed, candidate.opts, false, id, candidate.rot);
      if (!fit.ok) return { ok: false, why: fit.why ?? "Won't fit here" };
      if (isShop(candidate.type) && patch.rot !== undefined && Math.cos(fit.rot - candidate.rot) < 0.99) return { ok: false, why: "That entrance won't fit here" };
      candidate.x = fit.x; candidate.z = fit.z;
      if (candidate.type !== "lighthouse") candidate.rot = fit.rot + (candidate.type === "hull" && Math.cos(fit.rot - candidate.rot) < 0 ? Math.PI : 0);
    }
    if (candidate.scale !== undefined && (!Number.isFinite(candidate.scale) || candidate.scale < 0.1 || candidate.scale > 5)) return { ok: false, why: "Invalid prop size" };
    this.world.props.set(id, candidate);
    if (candidate.type === "grotto") this.world.rebuildCarving();
    return { ok: true, value: candidate, change: propChange(candidate.type) };
  }

  editNode(id: string, patch: { lift?: number; pad?: number }): EditResult<{ node: WalkNode; clamped: boolean }> {
    const node = this.world.nodes.get(id);
    if (!node) return { ok: false, why: "Post no longer exists" };
    if ((patch.lift !== undefined && !Number.isFinite(patch.lift)) ||
        (patch.pad !== undefined && (!Number.isFinite(patch.pad) || patch.pad < 0 || patch.pad > 5))) return { ok: false, why: "Invalid post edit" };
    let clamped = false;
    let y = node.y;
    if (patch.lift !== undefined) {
      const want = Math.min(20, node.y + patch.lift);
      y = clampStair(this.world, node, want);
      clamped = Math.abs(y - want) > 1e-6;
      y = Math.max(Math.max(this.world.height(node.x, node.z), WATER_Y) + 0.2, y);
    }
    const next = { ...node, y, pad: patch.pad ?? node.pad };
    this.world.nodes.set(id, next);
    this.settleWalks(new Set([id]));
    return { ok: true, value: { node: next, clamped }, change: { structures: true } };
  }

  editEdge(id: string, patch: Partial<Pick<WalkEdge, "style" | "width" | "rail">>): EditResult<WalkEdge> {
    const edge = this.world.edges.get(id);
    if (!edge) return { ok: false, why: "Walkway no longer exists" };
    if (patch.width !== undefined && (!Number.isFinite(patch.width) || patch.width < 0.1 || patch.width > 5) ||
        patch.style !== undefined && patch.style !== "deck" && patch.style !== "rope" ||
        patch.rail !== undefined && typeof patch.rail !== "boolean") return { ok: false, why: "Invalid walkway edit" };
    const next = { ...edge, ...patch };
    this.world.edges.set(id, next);
    this.settleWalks(new Set([next.a, next.b]));
    return { ok: true, value: next, change: { structures: true } };
  }

  removeProp(id: string): WorldChange | null {
    const p = this.world.props.get(id);
    if (!p) return null;
    this.world.props.delete(id);
    if (p.type === "grotto") this.world.rebuildCarving();
    return propChange(p.type);
  }

  clearBuildings() {
    const w = this.world;
    const grotto = [...w.props.values()].some(p => p.type === "grotto");
    w.houses.clear(); w.nodes.clear(); w.edges.clear();
    for (const p of [...w.props.values()]) if (!isGreenery(p.type)) w.props.delete(p.id);
    if (grotto) w.rebuildCarving();
    w.version++;
  }
}
