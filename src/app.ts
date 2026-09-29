import * as THREE from "three/webgpu";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { World, N, uid, newVolume, DECK_Y, Prop, PropType, WalkNode, WalkEdge, PAINT_CH, PaintType, carveCove } from "./world";
import { Terrain } from "./terrain";
import type { Materials } from "./materials";
import { LightMap } from "./lighting";
import { MeshBuilder } from "./mesh";
import { buildHouse, makeHouse, HouseBuild, Light } from "./houses";
import { buildWalks, defaultDeckY, WALK_W } from "./walks";
import { buildProps, buildBoat, updateBoat, Boat, stringLights, PROP_INFO } from "./props";

const SAVE_KEY = "grotto.cove.v1";

export interface AppDeps {
  renderer: THREE.WebGPURenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
  world: World; terrain: Terrain; mats: Materials; lightMap: LightMap; water: THREE.Mesh; pipeline: THREE.RenderPipeline;
}

/** Owns the generated meshes and rebuilds them when the world changes. */
export class App {
  hour = 16.4;
  playing = false;
  speed = 1;
  settings = { fps: 60 };
  time = 0;
  structures: THREE.Mesh;
  boats: Boat[] = [];
  boatGroup = new THREE.Group();
  dirty = { terrain: true, paint: true, structures: true };
  onChange: (() => void) | null = null;
  private saveTimer = 0;
  private history: string[] = [];
  private future: string[] = [];

  constructor(public d: AppDeps) {
    this.structures = new THREE.Mesh(new THREE.BufferGeometry(), d.mats.building);
    this.structures.castShadow = this.structures.receiveShadow = true;
    d.scene.add(this.structures, this.boatGroup);
  }

  get world() { return this.d.world; }

  // ---------- persistence ----------
  restore() {
    try {
      const s = localStorage.getItem(SAVE_KEY);
      if (!s) return false;
      const o = JSON.parse(s);
      this.world.load(o.world);
      if (typeof o.hour === "number") this.hour = o.hour;
      return true;
    } catch { return false; }
  }
  save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ world: this.world.save(), hour: this.hour })); } catch { /* quota */ } }
  scheduleSave() { clearTimeout(this.saveTimer); this.saveTimer = window.setTimeout(() => this.save(), 600); }

  // ---------- undo ----------
  /** Call before a change: snapshots the current state. */
  begin() {
    this.history.push(JSON.stringify(this.world.save()));
    if (this.history.length > 80) this.history.shift();
    this.future.length = 0;
  }
  /** Drop the last snapshot (the change didn't happen). */
  cancel() { this.history.pop(); }
  undo() { const s = this.history.pop(); if (!s) return false; this.future.push(JSON.stringify(this.world.save())); this.world.load(JSON.parse(s)); this.markAll(); return true; }
  redo() { const s = this.future.pop(); if (!s) return false; this.history.push(JSON.stringify(this.world.save())); this.world.load(JSON.parse(s)); this.markAll(); return true; }

  markAll() { this.dirty = { terrain: true, paint: true, structures: true }; this.world.version++; this.scheduleSave(); this.onChange?.(); }
  changed(d: Partial<App["dirty"]>) {
    Object.assign(this.dirty, d);
    if (d.terrain) this.dirty.structures = true;
    this.world.version++; this.scheduleSave(); this.onChange?.();
  }

  rebuildAll() { this.dirty = { terrain: true, paint: true, structures: true }; this.rebuild(); }
  rebuild() {
    const { terrain } = this.d;
    if (this.dirty.terrain) { terrain.rebuild(); this.dirty.terrain = false; }
    if (this.dirty.paint) { terrain.updatePaint(); this.dirty.paint = false; }
    if (this.dirty.structures) { this.buildStructures(); this.dirty.structures = false; }
  }

  buildStructures() {
    const w = this.world;
    const mb = new MeshBuilder();
    const out: HouseBuild = { mb, lights: [], anchors: [], foam: [] };
    for (const h of w.houses.values()) buildHouse(w, h, out);
    buildWalks(w, mb, out);
    buildProps(w, mb, out);
    stringLights(out.anchors, mb, out);
    this.structures.geometry.dispose();
    this.structures.geometry = mb.toGeometry();
    this.structures.userData.owners = mb.owners;
    this.structures.userData.triOwner = mb.triOwner;
    // boats
    for (const b of this.boats) { b.mesh.geometry.dispose(); this.boatGroup.remove(b.mesh); }
    this.boats = [];
    for (const p of w.props.values()) if (PROP_INFO[p.type]?.water) {
      const b = buildBoat(p, this.d.mats.building);
      this.boats.push(b); this.boatGroup.add(b.mesh);
      const c = Math.cos(p.rot), s = Math.sin(p.rot), L = p.type === "sloop" ? 1.8 : 0.9;
      for (let k = -1; k <= 1; k++) out.foam.push({ x: p.x - s * L * k * 0.7, z: p.z + c * L * k * 0.7, r: p.type === "sloop" ? 0.4 : 0.22 });
    }
    this.d.terrain.setFoam(out.foam);
    this.lights = out.lights;
    this.d.lightMap.update(out.lights.map((l: Light) => ({ x: l.x, z: l.z, r: l.r, i: l.i })));
  }
  lights: Light[] = [];

  update(dt: number) {
    this.time += dt;
    if (this.playing) this.hour = (this.hour + dt * this.speed * 24 / 300) % 24;
    this.rebuild();
    for (const b of this.boats) updateBoat(b, this.time);
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
  /** A sea grotto cuts a flooded channel into whatever cliff it's set against, under its rock vault. */
  carveGrotto(p: Prop) {
    const w = this.world, c = Math.cos(p.rot), s = Math.sin(p.rot);
    for (let j = Math.floor(p.z - 6); j <= Math.ceil(p.z + 6); j++) for (let i = Math.floor(p.x - 6); i <= Math.ceil(p.x + 6); i++) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const dx = i + 0.5 - p.x, dz = j + 0.5 - p.z;
      const lx = dx * c + dz * s, lz = -dx * s + dz * c; // world -> local
      if (lz > 1.5 || lz < -5.2) continue;
      const ax = Math.abs(lx);
      if (ax < 2.3 && lz < 1.5) w.setLevel(i, j, Math.min(w.level(i, j), 3));        // flooded floor
      else if (ax < 4.0 && lz < 0.5) w.setLevel(i, j, Math.min(w.level(i, j), 10));  // the vault's shoulders
    }
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

  /** A lived-in starter village for the cove. */
  starter() {
    const w = this.world;
    w.clear();
    carveCove(w);
    const H = (id: string, seed: number, vols: ReturnType<typeof newVolume>[], pal: number, opts: Partial<ReturnType<typeof makeHouse>> = {}) => {
      const h = { ...makeHouse(uid(id), seed, vols, pal), ...opts }; w.houses.set(h.id, h); return h;
    };
    // --- the pier and its stilt houses ---
    const beach = this.addNode(25, 15.3);
    const n1 = this.addNode(25, 19.2, DECK_Y);
    const hub = this.addNode(25, 24, DECK_Y);
    const head = this.addNode(25, 29, DECK_Y, 1.5);
    this.addEdge(beach, n1); this.addEdge(n1, hub); this.addEdge(hub, head);
    const west = this.addNode(20.3, 24.6, DECK_Y);
    const east = this.addNode(30.2, 24.0, DECK_Y);
    this.addEdge(hub, west); this.addEdge(hub, east);
    H("h", 0.113, [newVolume(16, 23, 19.5, 26.5, 2, "gable"), newVolume(16.5, 26.5, 18.5, 28.5, 1, "shed")], 0, { style: "plank" });
    H("h", 0.271, [newVolume(30.5, 22, 34, 25.5, 1, "hip"), newVolume(34, 22.5, 36, 24.5, 2, "flat")], 6);
    const nw = this.addNode(22.6, 18.6, DECK_Y);
    this.addEdge(n1, nw);
    H("h", 0.377, [newVolume(19, 17, 22, 19.5, 1, "gable")], 4, { style: "plank" });
    const pierEast = this.addNode(29.5, 29, DECK_Y);
    this.addEdge(head, pierEast);
    // --- beach boardwalk and the north terrace houses ---
    const bwW = this.addNode(19, 15.6), bwE = this.addNode(28.5, 15.2);
    this.addEdge(bwW, beach); this.addEdge(beach, bwE);
    H("h", 0.519, [newVolume(19.5, 11, 23, 13.5, 2, "gable"), newVolume(23, 11.5, 24.5, 13.5, 1, "shed")], 1);
    H("h", 0.638, [newVolume(26.5, 11.5, 29.5, 13.8, 1, "flat")], 5, { awning: true });
    const stepW = this.addNode(21.2, 14.35, 1.7);
    const bwMid = this.addNode(21.2, 15.5);
    this.addEdge(bwW, bwMid); this.addEdge(bwMid, beach);
    w.edges.forEach(e => { if ((e.a === bwW.id && e.b === beach.id)) w.edges.delete(e.id); });
    this.addEdge(bwMid, stepW);
    // --- west terraces: a cluster with a lookout on the cliff ---
    H("h", 0.702, [newVolume(6.5, 24.5, 9.5, 27.5, 2, "hip")], 2);
    H("h", 0.811, [newVolume(6.5, 30, 9.5, 32.5, 1, "gable"), newVolume(9.5, 30.5, 10.5, 32, 1, "shed")], 3, { style: "plank" });
    H("h", 0.905, [newVolume(3, 19.5, 5, 21.5, 3, "hip", ), ], 7).volumes[0].kind = "lookout";
    // --- east: lookout tower on the headland ---
    H("h", 0.955, [newVolume(41, 36, 43, 38, 3, "hip")], 0).volumes[0].kind = "lookout";
    // --- props ---
    this.addProp("hull", 31.2, 17.4, Math.PI / 2 + 0.12, 0.42);
    this.addProp("grotto", 41.5, 41.2, Math.PI / 2, 0.3);
    this.addProp("lighthouse", 2.8, 44.5, 0, 0.2);
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
    this.addProp("lantern", 23.5, 15.9, 0, 0.1);
    this.addProp("crane", 26.1, 30.1, -0.6, 0.5);
    this.addProp("barrels", 10.5, 23.4, 0, 0.9);
    // --- paint: cobbles by the terrace houses, sandy paths ---
    for (let x = 18; x <= 30; x += 1) this.paintDisc("cobble", x, 14.2, 0.9);
    for (let z = 23; z <= 34; z += 1) this.paintDisc("path", 10.7, z, 0.6);
    for (let z = 18; z <= 23; z += 1) this.paintDisc("path", 10 + (z - 18) * 0.15, z, 0.5);
    this.paintDisc("greenery", 5, 28.5, 1.8); this.paintDisc("greenery", 25, 10.5, 1.6); this.paintDisc("greenery", 31.5, 11, 1.2);
    w.pruneNodes();
    w.version++;
  }
}
