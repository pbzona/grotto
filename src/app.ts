import * as THREE from "three/webgpu";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { World, N, uid, newVolume, DECK_Y, Prop, PropType, WalkNode, WalkEdge, PAINT_CH, PaintType, carveCove, CoveKind, COVES, WATER_Y, isLandmark, landmarkSamples } from "./world";
import { Terrain } from "./terrain";
import type { Materials } from "./materials";
import { LightMap } from "./lighting";
import { MeshBuilder, Part, mergeParts, rng } from "./mesh";
import { buildHouse, makeHouse, houseLayout, HouseBuild, Light } from "./houses";
import { seedCove } from "./seed";
import { fitLandmark } from "./landmarks";
import { buildWalks, defaultDeckY, WALK_W, MAX_STAIR, slopeOf } from "./walks";
import { Fleet } from "./voyages";
import { buildProps, buildBoat, updateBoat, Boat, stringLights, PROP_INFO, buildScatter, isGreenery } from "./props";
import { Edits } from "./edits";
import { CROWDS, CROWD_KEY, DEFAULT_CROWD } from "./villagers";

const SAVE_KEY = "grotto.cove.v1";
function readCrowd() {
  try { const n = Number(localStorage.getItem(CROWD_KEY)); if (Number.isInteger(n) && n >= 0 && n < CROWDS.length && localStorage.getItem(CROWD_KEY) !== null) return n; } catch { /* no storage */ }
  return DEFAULT_CROWD;
}

export interface AppDeps {
  renderer: THREE.WebGPURenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
  world: World; terrain: Terrain; mats: Materials; lightMap: LightMap; water: THREE.Mesh; pipeline: THREE.RenderPipeline;
}

/** Owns the generated meshes and rebuilds them when the world changes. */
export class App {
  hour = 16.4;
  playing = false;
  speed = 1;
  settings = { fps: 60, crowd: readCrowd() };
  time = 0;
  structures: THREE.Mesh;
  boats: Boat[] = [];
  /** Where the boats go by day; replanned (throttled) when the world changes. */
  fleet = new Fleet();
  private fleetVersion = -1;
  private fleetWait = 0;
  private shoreFoam: { x: number; z: number; r: number }[] = [];
  private foamKey = "";
  boatGroup = new THREE.Group();
  dirty = { terrain: true, paint: true, structures: true };
  onChange: (() => void) | null = null;
  private saveTimer = 0;
  private recoverySave: string | null = null;
  readonly edits: Edits;
  private gesture = false;
  saveError: string | null = null;
  onSaveError: ((message: string) => void) | null = null;

  constructor(public d: AppDeps) {
    this.edits = new Edits(d.world);
    this.structures = new THREE.Mesh(new THREE.BufferGeometry(), d.mats.building);
    this.structures.castShadow = this.structures.receiveShadow = true;
    d.scene.add(this.structures, this.boatGroup);
  }

  get world() { return this.d.world; }

  // ---------- persistence ----------
  restore() {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const o = JSON.parse(raw);
      this.loadFile(o);
      this.settleWalks();
      return true;
    } catch {
      this.recoverySave = raw;
      try { if (raw !== null) { localStorage.setItem(SAVE_KEY + ".recovery", raw); this.recoverySave = null; } } catch { /* Keep it pending; never replace the original before backing it up. */ }
      this.saveError = this.recoverySave === null ? "Saved cove could not be loaded. A recovery copy is kept in browser storage." : "Saved cove could not be loaded or backed up. Export your new work; the original save is protected.";
      return false;
    }
  }
  loadFile(input: unknown) {
    if (!input || typeof input !== "object") throw new Error("Invalid cove file");
    const o = input as { world?: unknown; hour?: unknown; cove?: { kind?: unknown; seed?: unknown } };
    if (o.hour !== undefined && (typeof o.hour !== "number" || !Number.isFinite(o.hour) || o.hour < 0 || o.hour >= 24)) throw new Error("Invalid time");
    this.world.load(o.world);
    if (typeof o.hour === "number") this.hour = o.hour;
    // where the land came from is a convenience for Reroll; an unknown value just falls back
    const c = o.cove;
    this.cove = c && COVES.some(p => p.kind === c.kind) && typeof c.seed === "number" && Number.isFinite(c.seed) ? { kind: c.kind as CoveKind, seed: c.seed } : { kind: "classic", seed: 0 };
  }
  importFile(input: unknown) {
    this.begin(true);
    try { this.loadFile(input); this.markAll(); this.commit(); }
    catch (error) { this.cancel(); throw error; }
  }
  save() {
    if (this.edits.active) return false;
    try {
      if (this.recoverySave !== null) { localStorage.setItem(SAVE_KEY + ".recovery", this.recoverySave); this.recoverySave = null; }
      localStorage.setItem(SAVE_KEY, JSON.stringify({ world: this.world.save(), hour: this.hour, cove: this.cove })); this.saveError = null; return true;
    }
    catch { const message = "Cove could not be saved. Export a copy to keep your work."; if (this.saveError !== message) this.onSaveError?.(message); this.saveError = message; return false; }
  }
  scheduleSave() { clearTimeout(this.saveTimer); this.saveTimer = window.setTimeout(() => this.save(), 600); }

  // ---------- undo ----------
  begin(gesture = false) { this.commit(); this.edits.begin(); this.gesture = gesture; }
  commit() { const changed = this.edits.commit(); this.gesture = false; this.endInteraction(); if (changed) this.scheduleSave(); return changed; }
  cancel() { const changed = this.edits.cancel(); this.gesture = false; this.endInteraction(); if (changed) this.markAll(); }
  undo() { this.cancel(); if (!this.edits.undo()) return false; this.markAll(); return true; }
  redo() { this.cancel(); if (!this.edits.redo()) return false; this.markAll(); return true; }

  markAll() { this.world.rebuildCarving(); this.dirty = { terrain: true, paint: true, structures: true }; this.world.version++; if (!this.gesture) { this.commit(); this.scheduleSave(); } this.onChange?.(); }
  changed(d: Partial<App["dirty"]>) {
    if (d.terrain || d.structures) this.world.rebuildCarving();
    for (const key of ["terrain", "paint", "structures"] as const) if (d[key]) this.dirty[key] = true;
    if (d.terrain || d.paint) this.dirty.structures = true;
    this.world.version++; if (!this.gesture) { this.commit(); this.scheduleSave(); } this.onChange?.();
  }

  rebuildAll() { this.dirty = { terrain: true, paint: true, structures: true }; this.rebuild(); }
  rebuild() {
    const { terrain } = this.d;
    if (this.dirty.terrain) { terrain.rebuild(); this.terrainVersion++; this.dirty.terrain = false; }
    if (this.dirty.paint) { terrain.updatePaint(); this.dirty.paint = false; }
    if (this.dirty.structures) { this.buildStructures(); this.dirty.structures = false; }
  }

  /** Terrain edits bump this so cached pieces that sit on the ground rebuild. */
  terrainVersion = 0;
  /** Set by the tools while a drag is in progress: the scatter layer waits until it ends. */
  interacting = false;
  private houseCache = new Map<string, { key: string; part: Part; b: Omit<HouseBuild, "mb"> }>();
  private restCache: { key: string; part: Part; b: Omit<HouseBuild, "mb"> } | null = null;
  private scatterCache: { key: string; part: Part } | null = null;
  private boatCache = new Map<string, { key: string; boat: Boat }>();
  lastBuildMs = 0;

  buildStructures() {
    const t0 = performance.now();
    const w = this.world;
    const parts: Part[] = [];
    const out: Omit<HouseBuild, "mb"> = { lights: [], anchors: [], foam: [] };
    const merge = (b: Omit<HouseBuild, "mb">) => { out.lights.push(...b.lights); out.anchors.push(...b.anchors); out.foam.push(...b.foam); };
    const liveNodes = [...w.nodes.values()].filter(n => w.edgesOf(n.id).length);
    // houses: each cached on its own description, the terrain and the walkways that can open doors in it
    const seen = new Set<string>();
    for (const h of w.houses.values()) {
      seen.add(h.id);
      const near = liveNodes.filter(n => h.volumes.some(v => n.x > v.x0 - 1.2 && n.x < v.x1 + 1.2 && n.z > v.z0 - 1.2 && n.z < v.z1 + 1.2));
      const key = JSON.stringify(h) + "|" + this.terrainVersion + "|" + JSON.stringify(near);
      let c = this.houseCache.get(h.id);
      if (!c || c.key !== key) {
        const hb: HouseBuild = { mb: new MeshBuilder(), lights: [], anchors: [], foam: [] };
        buildHouse(w, h, hb);
        c = { key, part: hb.mb.freeze(), b: { lights: hb.lights, anchors: hb.anchors, foam: hb.foam } };
        this.houseCache.set(h.id, c);
      }
      parts.push(c.part); merge(c.b);
    }
    for (const id of [...this.houseCache.keys()]) if (!seen.has(id)) this.houseCache.delete(id);
    // walkways + props
    const walkSig = JSON.stringify([...w.nodes.values()]) + JSON.stringify([...w.edges.values()]);
    const restKey = walkSig + JSON.stringify([...w.props.values()]) + "|" + this.terrainVersion + "|" + JSON.stringify([...w.houses.values()].map(h => h.volumes.map(v => [v.x0, v.z0, v.x1, v.z1])));
    if (!this.restCache || this.restCache.key !== restKey) {
      const rb: HouseBuild = { mb: new MeshBuilder(), lights: [], anchors: [], foam: [] };
      buildWalks(w, rb.mb, rb);
      buildProps(w, rb.mb, rb);
      this.restCache = { key: restKey, part: rb.mb.freeze(), b: { lights: rb.lights, anchors: [], foam: rb.foam } };
    }
    parts.push(this.restCache.part); merge(this.restCache.b);
    // natural scatter keeps clear of everything; it catches up once a drag ends
    const scKey = restKey + JSON.stringify([...w.houses.values()].map(h => h.volumes.map(v => [v.x0, v.z0, v.x1, v.z1]))) + w.paint.length + hashBytes(w.paint);
    if (!this.scatterCache || (this.scatterCache.key !== scKey && !this.interacting)) {
      const sm = new MeshBuilder(); buildScatter(w, sm);
      this.scatterCache = { key: scKey, part: sm.freeze() };
    } else if (this.scatterCache.key !== scKey) this.dirtyLater = true;
    parts.push(this.scatterCache.part);
    const smb = new MeshBuilder();
    stringLights(out.anchors, smb, out);
    parts.push(smb.freeze());
    const m = mergeParts(parts);
    this.structures.geometry.dispose();
    this.structures.geometry = m.geometry;
    this.structures.userData.owners = m.owners;
    this.structures.userData.triOwner = m.triOwner;
    const mb = { lights: out.lights, anchors: out.anchors, foam: out.foam };
    // boats
    const boatIds = new Set([...w.props.values()].filter(p => PROP_INFO[p.type]?.water).map(p => p.id));
    for (const [id, entry] of this.boatCache) if (!boatIds.has(id)) { entry.boat.mesh.geometry.dispose(); this.boatGroup.remove(entry.boat.mesh); this.boatCache.delete(id); }
    this.boats = [];
    this.shoreFoam = out.foam.slice(); this.foamKey = "";
    for (const p of w.props.values()) if (PROP_INFO[p.type]?.water) {
      const key = JSON.stringify(p);
      let entry = this.boatCache.get(p.id);
      if (!entry || entry.key !== key) {
        if (entry) { entry.boat.mesh.geometry.dispose(); this.boatGroup.remove(entry.boat.mesh); }
        entry = { key, boat: buildBoat(p, this.d.mats.building) };
        this.boatCache.set(p.id, entry); this.boatGroup.add(entry.boat.mesh);
      }
      const b = entry.boat;
      this.boats.push(b);
    }
    this.sailBoats(0);
    for (const b of this.boats) b.mesh.updateMatrixWorld(true);
    this.lights = out.lights;
    void mb;
    this.d.lightMap.update(out.lights.map((l: Light) => ({ x: l.x, z: l.z, r: l.r, i: l.i })));
    this.lastBuildMs = performance.now() - t0;
  }
  lights: Light[] = [];

  /** Deferred work (the scatter layer) waiting for a drag to finish. */
  dirtyLater = false;
  endInteraction() { this.interacting = false; if (this.dirtyLater) { this.dirtyLater = false; this.dirty.structures = true; } }
  update(dt: number) {
    this.time += dt;
    if (this.playing) this.hour = (this.hour + dt * this.speed * 24 / 300) % 24;
    this.rebuild();
    this.sailBoats(dt);
  }
  /** Put each boat where its day has taken it, and keep the mooring foam only under boats that are home. */
  sailBoats(dt: number) {
    const w = this.world;
    this.fleetWait -= dt;
    if (w.version !== this.fleetVersion && this.fleetWait <= 0) { this.fleet.replan(w); this.fleetVersion = w.version; this.fleetWait = 0.3; }
    let key = "";
    for (const b of this.boats) {
      const p = w.props.get(b.id), pose = this.fleet.pose(b.id, this.hour, dt);
      if (pose) { b.x = pose.x; b.z = pose.z; b.rot = pose.rot; b.vis = pose.vis; b.moving = pose.moving; }
      else if (p) { b.x = p.x; b.z = p.z; b.rot = p.rot; b.vis = 1; b.moving = false; }
      updateBoat(b, this.time);
      if (p && (!pose || pose.home)) key += b.id + ":" + p.x + "," + p.z + "," + p.rot + ";";
    }
    if (key === this.foamKey) return;
    this.foamKey = key;
    const foam = this.shoreFoam.slice();
    for (const b of this.boats) {
      const p = w.props.get(b.id), pose = this.fleet.pose(b.id, this.hour, 0);
      if (!p || (pose && !pose.home)) continue;
      const c = Math.cos(p.rot), s = Math.sin(p.rot), L = p.type === "sloop" ? 1.8 : 0.9;
      for (let k = -1; k <= 1; k++) foam.push({ x: p.x - s * L * k * 0.7, z: p.z + c * L * k * 0.7, r: p.type === "sloop" ? 0.4 : 0.22 });
    }
    this.d.terrain.setFoam(foam);
  }

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
    const nearHouse = (n: WalkNode) => !!w.houseAt(n.x, n.z, 0.9);
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
      const x = Math.round((A.x + (B.x - A.x) * t) * 4) / 4, z = Math.round((A.z + (B.z - A.z) * t) * 4) / 4;
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
        if (w.edgesOf(lo.id).length === 1 && w.houseAt(lo.x, lo.z, 0.9)) continue; // a door: the floor sets it
        lo.y = Math.ceil((hi.y - MAX_STAIR * L) * 20 - 1e-6) / 20;
        next.add(lo.id);
      }
      live.clear(); for (const id of next) live.add(id);
    }
  }

  carveGrotto(_p: Prop) { this.world.rebuildCarving(); }
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

  /** Which preset and seed the current land was generated from (for Reroll). */
  cove: { kind: CoveKind; seed: number } = { kind: "classic", seed: 0 };

  /**
   * Fresh land from a preset. The cove at seed 0 gets the hand-built village;
   * everything else is seeded with a small generated one.
   */
  newCove(kind: CoveKind, seed: number) {
    if (kind === "classic" && seed === 0) { this.starter(); return; }
    const w = this.world;
    w.clear();
    carveCove(w, kind, seed);
    this.cove = { kind, seed };
    seedCove(this, seed);
    w.version++;
  }

  /** Everything built goes (houses, walkways, boats, clutter, landmarks); land, paint and greenery stay. */
  clearBuildings() {
    const w = this.world;
    const grotto = [...w.props.values()].some(p => p.type === "grotto");
    w.houses.clear(); w.nodes.clear(); w.edges.clear();
    for (const p of [...w.props.values()]) if (!isGreenery(p.type)) w.props.delete(p.id);
    if (grotto) w.rebuildCarving();
    w.version++;
  }

  /** A lived-in starter village for the cove. */
  starter() {
    const w = this.world;
    w.clear();
    carveCove(w);
    this.cove = { kind: "classic", seed: 0 };
    const H = (id: string, seed: number, vols: ReturnType<typeof newVolume>[], pal: number, opts: Partial<ReturnType<typeof makeHouse>> = {}) => {
      const h = { ...makeHouse(uid(id), seed, vols, pal), ...opts }; w.houses.set(h.id, h); return h;
    };
    // --- the pier and its stilt houses ---
    // every stretch runs along an axis, on the quarter grid (so posts settleWalks adds stay in line)
    const beach = this.addNode(25, 16.25);
    const n1 = this.addNode(25, 18.5, DECK_Y);
    const hub = this.addNode(25, 24, DECK_Y);
    const head = this.addNode(25, 29, DECK_Y, 1.5);
    this.addEdge(beach, n1); this.addEdge(n1, hub); this.addEdge(hub, head);
    const west = this.addNode(20.25, 24, DECK_Y);
    const east = this.addNode(30.25, 24, DECK_Y);
    this.addEdge(hub, west); this.addEdge(hub, east);
    H("h", 0.113, [newVolume(16, 23, 19.5, 26.5, 2, "gable"), newVolume(16.5, 26.5, 18.5, 28.5, 1, "shed")], 0, { style: "plank" });
    H("h", 0.271, [newVolume(30.5, 22, 34, 25.5, 1, "hip"), newVolume(34, 22.5, 36, 24.5, 2, "flat")], 6);
    const nw = this.addNode(22.5, 18.5, DECK_Y);
    this.addEdge(n1, nw);
    H("h", 0.377, [newVolume(19, 17, 22, 19.5, 1, "gable")], 4, { style: "plank" });
    const pierEast = this.addNode(29.5, 29, DECK_Y);
    this.addEdge(head, pierEast);
    // --- a boardwalk along the waterline and the north terrace houses, with steps (no steeper than MAX_STAIR) up to each door ---
    const bwW = this.addNode(21.25, 16.25), bwE = this.addNode(28, 16.25);
    this.addEdge(bwW, beach); this.addEdge(beach, bwE);
    const hW = H("h", 0.519, [newVolume(19.5, 11, 23, 13.5, 2, "gable"), newVolume(23, 11.5, 24.5, 13.5, 1, "shed")], 1);
    const hE = H("h", 0.638, [newVolume(26.5, 11.5, 29.5, 13.8, 1, "flat")], 5, { awning: true });
    const stepW = this.addNode(21.25, 14.25, houseLayout(w, hW).base);
    const stepE = this.addNode(28, 14.25, houseLayout(w, hE).base);
    this.addEdge(bwW, stepW); this.addEdge(bwE, stepE);
    // --- west terraces: a cluster with a lookout on the cliff ---
    // a stepped house: one end lifted a storey, the rest a roof terrace with a door onto it
    { const lo = newVolume(8, 24.5, 9.5, 27.5, 1, "flat"), hi = newVolume(6.5, 24.5, 8, 27.5, 2, "gable"); hi.ridgeX = false;
      const bay = newVolume(7, 27.5, 8, 28, 2, "gable"); bay.ridgeX = false;
      H("h", 0.702, [hi, lo, bay], 2); }
    // cliff houses perched on sandstone outcrops
    { const a = newVolume(13, 12, 16, 14.5, 2, "gable"), b = newVolume(16, 12.5, 17.5, 14, 1, "flat");
      H("h", 0.431, [a, b], 5, { foundation: "rock" }); }
    { const a = newVolume(38.5, 29.5, 41, 32.5, 2, "hip"), b = newVolume(38.5, 32.5, 40, 33.5, 1, "gable"); b.ridgeX = false;
      H("h", 0.587, [a, b], 1, { foundation: "rock" }); }
    H("h", 0.811, [newVolume(6.5, 30, 9.5, 32.5, 1, "gable"), newVolume(9.5, 30.5, 10.5, 32, 1, "shed")], 3, { style: "plank" });
    H("h", 0.905, [newVolume(3, 19.5, 5, 21.5, 3, "hip", ), ], 7).volumes[0].kind = "lookout";
    // --- east: lookout tower on the headland ---
    H("h", 0.955, [newVolume(41, 36, 43, 38, 3, "hip")], 0).volumes[0].kind = "lookout";
    // --- props ---
    // landmarks are sited by the same solver the tools use
    for (const [type, x, z, seed, opts] of [["hull", 31.2, 17.4, 0.42, { cabin: "stern", annex: "deck", masts: 1 }], ["grotto", 41.5, 40.5, 0.3, { dock: "left" }], ["lighthouse", 2.8, 44.5, 0.2, {}]] as const) {
      const f = fitLandmark(w, type, x, z, seed, { ...opts }, false);
      const p = this.addProp(type, f.ok ? f.x : x, f.ok ? f.z : z, f.ok ? f.rot : 0, seed);
      p.opts = { ...opts };
      if (type === "grotto") this.carveGrotto(p);
    }
    this.addProp("sloop", 21.6, 30.2, 0.1, 0.61);
    this.addProp("rowboat", 27.5, 30.9, Math.PI / 2 - 0.2, 0.17);
    this.addProp("rowboat", 18.3, 29.8, 0.4, 0.83);
    this.addProp("rowboat", 23.2, 21.5, -0.2, 0.33);
    for (const [x, z, s] of [[17.2, 14.8, 1], [27.8, 16.6, 2], [12.2, 20.4, 3], [11.2, 27.5, 4], [36.4, 27, 5], [35.8, 33.5, 6], [15, 15.8, 7], [33.8, 20.5, 8]] as const)
      this.addProp("palm", x, z, s, s * 0.137);
    for (const [x, z] of [[24.2, 13.8], [18.9, 12.3], [10.2, 26], [10.4, 29.2], [30.2, 12.6], [37.4, 23.4]] as const) this.addProp("bougainvillea", x, z, 0, x * 0.01);
    for (const [x, z] of [[13, 13], [9, 18], [38, 14], [39, 30], [14.5, 36], [34, 37]] as const) this.addProp("scrub", x, z, 0, z * 0.01);
    for (const [x, z] of [[11.4, 33.8], [36.7, 36.5], [14.2, 38.6]] as const) this.addProp("rock", x, z, x, 0.3);
    this.addProp("crates", 24.4, 29.7, 0.3, 0.2);
    this.addProp("barrels", 26, 28.3, 0, 0.4);
    this.addProp("nets", 13.2, 17.8, 0.9, 0.5);
    this.addProp("laundry", 8, 29, 0, 0.7);
    this.addProp("lantern", 23.5, 16.7, 0, 0.1);
    this.addProp("crane", 26.1, 30.1, -0.6, 0.5);
    this.addProp("barrels", 10.5, 23.4, 0, 0.9);
    // --- paint: cobbles by the terrace houses, sandy paths ---
    for (let x = 18; x <= 30; x += 1) this.paintDisc("cobble", x, 14.2, 0.9);
    for (let z = 23; z <= 34; z += 1) this.paintDisc("path", 10.7, z, 0.6);
    for (let z = 18; z <= 23; z += 1) this.paintDisc("path", 10 + (z - 18) * 0.15, z, 0.5);
    this.paintDisc("greenery", 5, 28.5, 1.8); this.paintDisc("greenery", 25, 10.5, 1.6); this.paintDisc("greenery", 31.5, 11, 1.2);
    this.settleWalks(); this.easeStairs();
    // nothing small may end up inside a landmark
    for (const lm of [...w.props.values()].filter(p => isLandmark(p.type))) {
      const pts = landmarkSamples(lm);
      for (const o of [...w.props.values()]) if (!isLandmark(o.type) && pts.some(([x, z]) => Math.hypot(x - o.x, z - o.z) < 0.7)) w.props.delete(o.id);
    }
    w.pruneNodes();
    w.version++;
  }
}

function hashBytes(a: Uint8Array) { let h = 2166136261; for (let i = 0; i < a.length; i += 3) { h ^= a[i]; h = Math.imul(h, 16777619); } return h >>> 0; }
