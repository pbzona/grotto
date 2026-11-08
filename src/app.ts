import * as THREE from "three/webgpu";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { World, carveCove, COVES, type CoveKind } from "./world.ts";
import { Terrain } from "./terrain.ts";
import type { Materials } from "./materials.ts";
import { LightMap } from "./lighting.ts";
import { MeshBuilder, mergeParts, type Part } from "./mesh.ts";
import { buildHouse, type HouseBuild, type Light, type Face } from "./houses.ts";
import { seedCove, seedStarter } from "./seed.ts";
import { buildWalks } from "./walks.ts";
import { buildProps, buildBoat, updateBoat, stringLights, washingLines, PROP_INFO, buildScatter, type Boat } from "./props.ts";
import { Edits } from "./edits.ts";
import { WorldOps, type WorldChange } from "./world-ops.ts";
import { CROWDS, CROWD_KEY, DEFAULT_CROWD } from "./villagers.ts";

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
    this.ops = new WorldOps(d.world);
    this.edits = new Edits(d.world, {
      capture: includeHour => ({ cove: this.cove, ...(includeHour ? { hour: this.hour } : {}) }),
      restore: value => {
        const state = value as { cove: App["cove"]; hour?: number };
        this.cove = state.cove;
        if (state.hour !== undefined) this.hour = state.hour;
      },
    });
    this.structures = new THREE.Mesh(new THREE.BufferGeometry(), d.mats.building);
    this.structures.castShadow = this.structures.receiveShadow = true;
    d.scene.add(this.structures, this.boatGroup);
  }

  get world() { return this.d.world; }
  readonly ops: WorldOps;

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
    this.begin(true, true);
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
  begin(gesture = false, includeHour = false) { this.commit(); this.edits.begin(includeHour); this.gesture = gesture; }
  commit() { const changed = this.edits.commit(); this.gesture = false; this.endInteraction(); if (changed) this.scheduleSave(); return changed; }
  cancel() { const changed = this.edits.cancel(); this.gesture = false; this.endInteraction(); if (changed) this.markAll(); }
  undo() { this.cancel(); if (!this.edits.undo()) return false; this.markAll(); return true; }
  redo() { this.cancel(); if (!this.edits.redo()) return false; this.markAll(); return true; }

  markAll() { this.world.rebuildCarving(); this.dirty = { terrain: true, paint: true, structures: true }; this.world.version++; if (!this.gesture) { this.commit(); this.scheduleSave(); } this.onChange?.(); }
  recordChange(change: WorldChange) { this.changed(change); }
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
    const out: Omit<HouseBuild, "mb"> & { faces: Face[] } = { lights: [], anchors: [], foam: [], faces: [] };
    const merge = (b: Omit<HouseBuild, "mb">) => { out.lights.push(...b.lights); out.anchors.push(...b.anchors); out.foam.push(...b.foam); out.faces.push(...b.faces ?? []); };
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
        c = { key, part: hb.mb.freeze(), b: { lights: hb.lights, anchors: hb.anchors, foam: hb.foam, faces: hb.faces } };
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
    washingLines(w, out.faces, smb);
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
      updateBoat(b, this.time); b.mesh.updateMatrixWorld(true);
      const c = Math.cos(p.rot), s = Math.sin(p.rot), L = p.type === "sloop" ? 1.8 : 0.9;
      for (let k = -1; k <= 1; k++) out.foam.push({ x: p.x - s * L * k * 0.7, z: p.z + c * L * k * 0.7, r: p.type === "sloop" ? 0.4 : 0.22 });
    }
    this.d.terrain.setFoam(out.foam);
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
    for (const b of this.boats) updateBoat(b, this.time);
  }

  // Public browser/test facade; all world rules live in WorldOps.
  addNode(...args: Parameters<WorldOps["addNode"]>) { return this.ops.addNode(...args); }
  addEdge(...args: Parameters<WorldOps["addEdge"]>) { return this.ops.addEdge(...args); }
  addProp(...args: Parameters<WorldOps["addProp"]>) { return this.ops.addProp(...args); }
  settleWalks(...args: Parameters<WorldOps["settleWalks"]>) { return this.ops.settleWalks(...args); }
  easeStairs(...args: Parameters<WorldOps["easeStairs"]>) { return this.ops.easeStairs(...args); }
  fairStairs(...args: Parameters<WorldOps["fairStairs"]>) { return this.ops.fairStairs(...args); }
  mergeInline(...args: Parameters<WorldOps["mergeInline"]>) { return this.ops.mergeInline(...args); }
  removePost(...args: Parameters<WorldOps["removePost"]>) { return this.ops.removePost(...args); }
  carveGrotto(...args: Parameters<WorldOps["carveGrotto"]>) { return this.ops.carveGrotto(...args); }
  paintDisc(...args: Parameters<WorldOps["paintDisc"]>) { return this.ops.paintDisc(...args); }

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
    seedCove(this.ops, seed);
    w.version++;
  }

  clearBuildings() { this.ops.clearBuildings(); }

  starter() { seedStarter(this.ops); this.cove = { kind: "classic", seed: 0 }; }

}

function hashBytes(a: Uint8Array) { let h = 2166136261; for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619); } return h >>> 0; }
